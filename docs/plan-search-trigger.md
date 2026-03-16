# Plan: Search Salesforce Trigger

## Context

Currently, all routing is real-time — an Apex trigger fires on record insert/update, POSTs to the engine, and the engine routes immediately. The Search Salesforce Trigger enables **batch/retrospective routing**: the system queries Salesforce on a schedule (or manually) for records matching user-defined criteria, then feeds them through the same routing pipeline.

This is a new route type (`SCHEDULED`) that runs independently of the Apex trigger.

**Reference**: `route-builder-redesign.html` (updated version with Frequency section)

---

## Architecture Overview

```
                    REAL-TIME FLOW (existing)
                    ─────────────────────────
Salesforce Apex ──POST──▶ Engine /route ──▶ routeRecord() ──▶ SFDC Update


                    SCHEDULED FLOW (new)
                    ─────────────────────────
BullMQ Cron Job ──▶ Engine: runScheduledRoute()
                      │
                      ├── Build SOQL from searchCriteria + objectType
                      ├── Query Salesforce (batched, paginated)
                      ├── For each record: routeRecord({ ...fields, eventType: "SEARCH" })
                      ├── Update rule stats (lastRunAt, totalRuns, etc.)
                      └── Log run result

Web UI "Run Now" ──POST──▶ API /api/rules/[id]/run
                      │
                      └── Same flow as cron job (one-time execution)
```

Both flows converge at `routeRecord()` — the same evaluator, branches, match step, and assignment logic apply. The only difference is the **source of records** (webhook vs SOQL query).

---

## Schema Changes

(Shared with Route List Redesign — see `plan-route-list-redesign.md`)

Key fields on `RoutingRule`:
- `routeType: RouteType` — REALTIME or SCHEDULED
- `scheduleFrequency: String?` — "DAILY" | "WEEKLY" | "MONTHLY" | null (one-time)
- `scheduleTime: String?` — "06:00"
- `scheduleTimezone: String?` — "UTC"
- `scheduleCron: String?` — computed, e.g. "0 6 * * *"
- `searchCriteria: Json?` — ConditionGroup[] (same shape as triggerConditions)
- `lastRunAt`, `lastRunStatus`, `lastRunRecords`, `lastRunDurationMs`, `totalRuns`, `totalRecordsRouted`

### New enum value: `TriggerEvent`

Add `SEARCH` to the existing enum:
```prisma
enum TriggerEvent {
  INSERT
  UPDATE
  BOTH
  SEARCH    // new — for scheduled search routes
}
```

---

## Engine Changes

### File: `apps/engine/src/scheduler.ts` (NEW)

Responsible for managing BullMQ repeatable jobs for scheduled routes.

```typescript
import { Queue, Worker } from "bullmq"

const schedulerQueue = new Queue("route-scheduler", { connection: redis })

// Called on startup + cache invalidation
export async function syncScheduledJobs(orgId: string) {
  // 1. Load all ACTIVE + SCHEDULED rules for this org
  // 2. For each rule with scheduleCron:
  //    - Upsert repeatable job: schedulerQueue.upsertJobScheduler(
  //        `route-${rule.id}`,
  //        { pattern: rule.scheduleCron },
  //        { data: { ruleId: rule.id, orgId: rule.orgId } }
  //      )
  // 3. Remove jobs for rules that are now INACTIVE or deleted
}

// Worker processes scheduled route executions
const schedulerWorker = new Worker("route-scheduler", async (job) => {
  const { ruleId, orgId } = job.data
  await runScheduledRoute(ruleId, orgId)
}, { connection: redis })
```

### File: `apps/engine/src/search-runner.ts` (NEW)

Core logic for executing a scheduled search route.

```typescript
export async function runScheduledRoute(ruleId: string, orgId: string): Promise<RunResult> {
  const startTime = Date.now()

  // 1. Load rule from cache (or DB fallback)
  const rule = getCachedRule(ruleId)
  if (!rule || rule.status !== "ACTIVE") return { status: "SKIPPED" }

  // 2. Get SFDC connection for this org
  const conn = await getSfdcConnection(orgId)

  // 3. Build SOQL from searchCriteria
  const soql = buildSearchSOQL(rule.objectType, rule.searchCriteria)
  // e.g. "SELECT Id, Name, Email, ... FROM Lead WHERE Status = 'Open' AND Rating = 'Hot' AND CreatedDate > LAST_N_DAYS:7"

  // 4. Query Salesforce (paginated)
  let records: SfdcRecord[] = []
  let result = await conn.query(soql)
  records.push(...result.records)
  while (!result.done) {
    result = await conn.queryMore(result.nextRecordsUrl!)
    records.push(...result.records)
  }

  // 5. Optional: filter out recently-routed records (skip duplicates)
  if (rule.skipRecentlyRouted) {
    const recentIds = await getRecentlyRoutedIds(orgId, rule.objectType, 24 * 60 * 60 * 1000)
    records = records.filter(r => !recentIds.has(r.Id))
  }

  // 6. Route each record through the standard pipeline
  let routed = 0, failed = 0
  const batchSize = rule.batchSize || 200

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const results = await Promise.allSettled(
      batch.map(record => routeRecord({
        orgId,
        objectType: rule.objectType,
        eventType: "SEARCH",
        recordId: record.Id,
        fields: record,
      }))
    )
    routed += results.filter(r => r.status === "fulfilled" && r.value === "routed").length
    failed += results.filter(r => r.status === "rejected").length
  }

  // 7. Update rule stats
  const durationMs = Date.now() - startTime
  await updateRuleStats(ruleId, {
    lastRunAt: new Date(),
    lastRunStatus: failed === 0 ? "SUCCESS" : routed > 0 ? "PARTIAL" : "FAILED",
    lastRunRecords: routed,
    lastRunDurationMs: durationMs,
    totalRuns: { increment: 1 },
    totalRecordsRouted: { increment: routed },
  })

  return { status: "SUCCESS", recordsFound: records.length, recordsRouted: routed, durationMs }
}
```

### File: `apps/engine/src/soql-builder.ts` (NEW)

Converts searchCriteria (ConditionGroup[]) into a SOQL WHERE clause.

```typescript
export function buildSearchSOQL(objectType: string, criteria: ConditionGroup[]): string {
  const object = objectType === "LEAD" ? "Lead" : objectType === "CONTACT" ? "Contact" : "Account"

  // Get standard fields for SELECT
  const selectFields = getStandardFields(objectType)

  if (!criteria || criteria.length === 0) {
    return `SELECT ${selectFields} FROM ${object} LIMIT 50000`
  }

  // Build WHERE: AND within groups, OR between groups
  const groupClauses = criteria.map(group => {
    const conditions = group.conditions.map(c => conditionToSOQL(c))
    return conditions.length === 1 ? conditions[0] : `(${conditions.join(" AND ")})`
  })

  const where = groupClauses.length === 1 ? groupClauses[0] : groupClauses.join(" OR ")

  return `SELECT ${selectFields} FROM ${object} WHERE ${where} LIMIT 50000`
}

function conditionToSOQL(cond: Condition): string {
  const field = escapeSoqlField(cond.fieldApiName)
  const value = escapeSoqlValue(cond.value)

  switch (cond.operator) {
    case "equals":       return `${field} = '${value}'`
    case "not_equals":   return `${field} != '${value}'`
    case "contains":     return `${field} LIKE '%${value}%'`
    case "starts_with":  return `${field} LIKE '${value}%'`
    case "greater_than": return `${field} > ${value}`   // no quotes for numbers/dates
    case "less_than":    return `${field} < ${value}`
    case "is_blank":     return `${field} = null`
    case "is_not_blank": return `${field} != null`
    case "in":           return `${field} IN (${value.split(",").map(v => `'${v.trim()}'`).join(",")})`
    default:             return `${field} = '${value}'`
  }
}

// CRITICAL: Prevent SOQL injection
function escapeSoqlValue(val: string): string {
  return val.replace(/'/g, "\\'").replace(/\\/g, "\\\\")
}
```

### File: `apps/engine/src/router.ts` — Modifications

Add `SEARCH` to the eventType filter logic:
```typescript
// Current: filter by INSERT/UPDATE/BOTH
// New: SEARCH events bypass triggerEvent filtering entirely
//      (the search criteria already filtered the records)
if (eventType === "SEARCH") {
  // Skip triggerEvent check — search routes use their own criteria
  // Still evaluate trigger conditions, branches, match, assignment
}
```

### File: `apps/engine/src/cache.ts` — Modifications

Add new fields to `CachedRule`:
```typescript
interface CachedRule {
  // ... existing fields ...
  routeType: "REALTIME" | "SCHEDULED"
  searchCriteria: ConditionGroup[] | null
  scheduleFrequency: string | null
  scheduleCron: string | null
  batchSize: number
  skipRecentlyRouted: boolean
}
```

On cache invalidation, call `syncScheduledJobs(orgId)` to update BullMQ repeatable jobs.

---

## Web API Changes

### POST `/api/rules/[id]/run` (NEW)

```typescript
export async function POST(req: NextRequest, { params }) {
  const orgId = getOrgIdFromHeaders(req)
  const rule = await prisma.routingRule.findFirst({
    where: { id: params.id, orgId, routeType: "SCHEDULED" }
  })
  if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Forward to engine
  const res = await fetch(`${ENGINE_URL}/run-scheduled`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Org-Id": orgId },
    body: JSON.stringify({ ruleId: rule.id })
  })

  const result = await res.json()
  return NextResponse.json(result)
}
```

### GET `/api/rules/[id]/preview` (NEW)

Returns count of records matching searchCriteria without routing them.

```typescript
export async function GET(req: NextRequest, { params }) {
  // 1. Load rule + searchCriteria
  // 2. Build SOQL with COUNT()
  // 3. Query Salesforce
  // 4. Return { count, checkedAt }
}
```

### Engine endpoint: POST `/run-scheduled` (NEW)

```typescript
app.post("/run-scheduled", async (req, reply) => {
  const { ruleId } = req.body
  const orgId = req.headers["x-org-id"]
  const result = await runScheduledRoute(ruleId, orgId)
  return result
})
```

---

## Frontend Changes

### File: `apps/web/components/route-builder/types.ts`

```typescript
export type RouteType = "REALTIME" | "SCHEDULED"
export type ScheduleFrequency = "DAILY" | "WEEKLY" | "MONTHLY"

export interface RouteBuilderState {
  name: string
  routeType: RouteType                          // NEW
  trigger: { ... }                              // existing (for REALTIME)
  searchTrigger: SearchTriggerConfig | null      // NEW (for SCHEDULED)
  matchConfig: MatchConfig | null
  paths: RoutePath[]
  defaultOwner: DefaultOwner | null
}

export interface SearchTriggerConfig {
  triggerName: string
  objectType: ObjectType
  searchCriteria: ConditionGroup[]
  frequency: ScheduleFrequency | null           // null = one-time
  scheduleTime: string                          // "06:00"
  scheduleTimezone: string                      // "UTC"
  batchSize: number                             // 50 | 100 | 200 | 400
  skipRecentlyRouted: boolean
  isDryRun: boolean
}
```

### File: `apps/web/components/route-builder/config/SearchTriggerConfigSheet.tsx` (NEW)

New config panel for the Search Salesforce trigger node. Sections:

1. **Basic**: Trigger Name, Object Type dropdown
2. **Search Criteria**: ConditionBuilder (reuse existing component) with "Records matching ALL of these conditions" header
3. **Frequency**: Radio cards (Schedule / One-time)
   - Schedule: Repeat dropdown (Daily/Weekly/Monthly), Time picker, Timezone picker, "Next run" display
   - One-time: Amber disclaimer box about manual execution
4. **Preview**: Record count box with Refresh button (calls `/api/rules/[id]/preview`)
5. **Run History**: Compact table of last 3-5 runs (from `RoutingLog` or rule stats)
6. **Advanced** (collapsible): Batch size dropdown, Skip recently routed checkbox, Dry run checkbox

### File: `apps/web/components/route-builder/RouteBuilder.tsx` — Modifications

1. Add `searchTrigger` node type to canvas:
   - New node color: teal (`border-l-4 border-l-teal-500`)
   - Positioned beside the real-time trigger node (side by side at top)
   - Only shown when `routeType === "SCHEDULED"` or both triggers are configured
2. Add section labels on canvas margin: TRIGGERS, ACTIONS, NOTIFICATIONS
3. Add `SearchTriggerConfigSheet` to ActiveSheet union type
4. Update `computeEdges()` to handle multiple trigger nodes fanning out to match

### File: `apps/web/components/route-builder/StepRegistry.tsx`

Add new node type:
```typescript
searchTrigger: {
  icon: Search,
  label: "Search Salesforce",
  borderClass: "border-l-4 border-l-teal-500",
  iconBg: "bg-teal-100",
  iconColor: "text-teal-600",
}
```

### File: `apps/web/lib/builder-to-rule.ts` — Modifications

Add conversion for `searchTrigger`:
```typescript
if (state.searchTrigger) {
  body.routeType = "SCHEDULED"
  body.objectType = state.searchTrigger.objectType
  body.searchCriteria = state.searchTrigger.searchCriteria
  body.scheduleFrequency = state.searchTrigger.frequency
  body.scheduleTime = state.searchTrigger.scheduleTime
  body.scheduleTimezone = state.searchTrigger.scheduleTimezone
  body.triggerEvent = "SEARCH"
}
```

---

## Implementation Order

### Phase 1: Database + API (foundation)
1. Add `RouteType` enum + new fields to Prisma schema
2. Create migration
3. Update `GET /api/rules` to return new fields
4. Update `POST /api/rules` to accept new fields
5. Add `POST /api/rules/[id]/run` endpoint (stub — returns mock data)

### Phase 2: Engine — SOQL Builder + Search Runner
1. Create `soql-builder.ts` with `buildSearchSOQL()` + SOQL escaping
2. Create `search-runner.ts` with `runScheduledRoute()`
3. Add `POST /run-scheduled` engine endpoint
4. Update `cache.ts` with new CachedRule fields
5. Update `router.ts` to handle `eventType: "SEARCH"`
6. Write tests for SOQL builder (edge cases: special chars, dates, numbers, nulls)

### Phase 3: Engine — BullMQ Scheduler
1. Create `scheduler.ts` with `syncScheduledJobs()`
2. Wire into cache invalidation listener
3. Wire into engine startup (`loadAllRules` → `syncScheduledJobs`)
4. Test: create scheduled rule → verify BullMQ job created → verify execution

### Phase 4: Frontend — Route Builder UI
1. Add `SearchTriggerConfig` type to `types.ts`
2. Create `SearchTriggerConfigSheet.tsx`
3. Add `searchTrigger` node to `StepRegistry.tsx`
4. Update `RouteBuilder.tsx` canvas layout (dual trigger nodes, section labels)
5. Update `builder-to-rule.ts` conversion
6. Add `GET /api/rules/[id]/preview` for record count

### Phase 5: Frontend — Route List Page
(See `plan-route-list-redesign.md`)

---

## Verification

### Unit Tests
1. `soql-builder.test.ts` — SOQL generation from various criteria combinations
2. `search-runner.test.ts` — mock SFDC connection, verify batch processing
3. `builder-to-rule.test.ts` — verify searchTrigger → API body conversion

### Integration Tests
1. Create scheduled rule via API → verify DB fields saved correctly
2. Run scheduled route via API → verify SFDC query + routing
3. Verify BullMQ job creation for daily scheduled rule
4. Verify BullMQ job removal when rule is deactivated

### E2E Manual Test
1. Create new Scheduled route in UI → set criteria → set Daily schedule → Save
2. Verify route appears in list with "Scheduled" badge + schedule pill
3. Click Run button on list page → verify records routed
4. Open route → click Search Salesforce node → verify config panel shows criteria, schedule, preview count
5. Switch to One-time → verify disclaimer appears, no schedule fields
6. Wait for scheduled time → verify automatic execution (check lastRunAt)
