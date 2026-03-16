# Plan: Route List Page Redesign

## Context

The current Routing Rules list page (`apps/web/app/(dashboard)/routing-rules/page.tsx`) shows a basic table with 4 columns (Name, Object, Status toggle, Actions). With the introduction of Route Types (Real-Time vs Scheduled), the list page needs to visually differentiate route types, show type-specific metadata (schedule info, last run, run counts), and provide type-specific actions (Pause for real-time, Run for scheduled).

**Reference**: `routing-rules-list-prototype.html`

---

## Schema Changes

### 1. New enum: `RouteType`

```prisma
enum RouteType {
  REALTIME
  SCHEDULED
}
```

### 2. New fields on `RoutingRule`

```prisma
model RoutingRule {
  // ... existing fields ...

  routeType         RouteType       @default(REALTIME)

  // Scheduled route fields
  scheduleFrequency String?         // "DAILY" | "WEEKLY" | "MONTHLY" | null (one-time)
  scheduleTime      String?         // "06:00" (24h format)
  scheduleTimezone  String?         // "UTC", "US/Eastern", etc.
  scheduleCron      String?         // computed cron expression for BullMQ
  lastRunAt         DateTime?
  lastRunStatus     String?         // "SUCCESS" | "FAILED" | "PARTIAL"
  lastRunRecords    Int?            // count of records routed in last run
  lastRunDurationMs Int?
  totalRuns         Int             @default(0)
  totalRecordsRouted Int            @default(0)

  // Search trigger criteria (stored as JSON for flexibility)
  searchCriteria    Json?           // ConditionGroup[] — same format as triggerConditions
}
```

### 3. Migration

File: `packages/db/prisma/migrations/20260314000000_add_route_type/migration.sql`

```sql
-- CreateEnum
CREATE TYPE "RouteType" AS ENUM ('REALTIME', 'SCHEDULED');

-- AlterTable
ALTER TABLE "RoutingRule" ADD COLUMN "routeType" "RouteType" NOT NULL DEFAULT 'REALTIME';
ALTER TABLE "RoutingRule" ADD COLUMN "scheduleFrequency" TEXT;
ALTER TABLE "RoutingRule" ADD COLUMN "scheduleTime" TEXT;
ALTER TABLE "RoutingRule" ADD COLUMN "scheduleTimezone" TEXT;
ALTER TABLE "RoutingRule" ADD COLUMN "scheduleCron" TEXT;
ALTER TABLE "RoutingRule" ADD COLUMN "lastRunAt" TIMESTAMP(3);
ALTER TABLE "RoutingRule" ADD COLUMN "lastRunStatus" TEXT;
ALTER TABLE "RoutingRule" ADD COLUMN "lastRunRecords" INTEGER;
ALTER TABLE "RoutingRule" ADD COLUMN "lastRunDurationMs" INTEGER;
ALTER TABLE "RoutingRule" ADD COLUMN "totalRuns" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RoutingRule" ADD COLUMN "totalRecordsRouted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RoutingRule" ADD COLUMN "searchCriteria" JSONB;
```

---

## API Changes

### GET `/api/rules` — Add new fields to response

Add to the select/include in the Prisma query:
```
routeType, scheduleFrequency, scheduleTime, scheduleTimezone,
lastRunAt, lastRunStatus, lastRunRecords, lastRunDurationMs,
totalRuns, totalRecordsRouted
```

### POST `/api/rules` — Accept `routeType` + schedule fields

New fields in request body validation:
```typescript
routeType?: "REALTIME" | "SCHEDULED"  // default: "REALTIME"
scheduleFrequency?: "DAILY" | "WEEKLY" | "MONTHLY" | null
scheduleTime?: string       // "06:00"
scheduleTimezone?: string   // "UTC"
```

When `routeType === "SCHEDULED"` and `scheduleFrequency` is set, compute `scheduleCron` from the frequency + time.

### POST `/api/rules/[id]/run` — NEW endpoint

Manual trigger for scheduled routes:
1. Verify rule exists, belongs to org, is SCHEDULED type
2. Build SOQL from `searchCriteria` + `objectType`
3. Query Salesforce for matching records
4. Enqueue each record into the routing engine (BullMQ batch)
5. Update `lastRunAt`, `lastRunStatus`, `lastRunRecords`, `totalRuns`, `totalRecordsRouted`
6. Return `{ recordsFound, recordsRouted, durationMs }`

---

## Frontend Changes

### File: `apps/web/app/(dashboard)/routing-rules/page.tsx`

#### Updated `Rule` type

```typescript
interface Rule {
  // ... existing fields ...
  routeType: "REALTIME" | "SCHEDULED"
  scheduleFrequency: string | null
  scheduleTime: string | null
  scheduleTimezone: string | null
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunRecords: number | null
  totalRuns: number
  totalRecordsRouted: number
}
```

#### Layout: Replace table with card layout

Switch from `<Table>` to a card-based list (as in prototype). Each card shows:

```
[Type Icon] | Route Info (name, type badge, object badge, schedule pill) | Stats (routed, success/runs) | Status Switch + Actions
```

**Card structure** (flex row):
1. **Type indicator** — 40x40 rounded icon (violet for REALTIME, teal for SCHEDULED)
2. **Info section** (flex-1):
   - Top row: name + type badge + object badge + optional schedule pill + optional dry-run badge
   - Bottom row: meta text (trigger event, paths count, last triggered/run info)
3. **Stats section** — 2 stat boxes:
   - REALTIME: Total Routed + Success Rate
   - SCHEDULED: Total Routed + Run Count
4. **Status + Actions**:
   - Switch toggle (existing)
   - Type-specific action: Pause icon (REALTIME) or Play icon (SCHEDULED)
   - Edit, Clone, Delete (existing)

#### Filter bar

Replace the current header with filter tabs:
- All (count), Real-Time (count), Scheduled (count)
- Search input on the right

#### "New Route" dropdown

Replace single "New Route" button with dropdown:
- "Real-Time Route" — navigates to `/routing-rules/new?type=realtime`
- "Scheduled Route" — navigates to `/routing-rules/new?type=scheduled`

#### New mutation: `runMutation`

```typescript
const runMutation = useMutation({
  mutationFn: (id: string) => fetch(`/api/rules/${id}/run`, { method: "POST" }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["rules"] })
    toast.success("Route executed successfully")
  }
})
```

### New components needed

1. **`RouteCard`** — extracted card component (cleaner than inline JSX)
2. **`RouteTypeIndicator`** — icon + background for route type
3. **`SchedulePill`** — small pill showing "Daily · 6:00 AM UTC" or "One-time · Manual"
4. **`RouteStatBox`** — stat value + label

### File: `apps/web/app/(dashboard)/routing-rules/new/page.tsx`

Accept `?type=realtime|scheduled` query param. Pass `routeType` into the initial `RouteBuilderState`.

---

## Verification

1. Route list shows card layout with type badges and icons
2. Filter tabs correctly filter by route type
3. "New Route" dropdown shows both options
4. Real-Time routes show Pause button, Scheduled routes show Run (play) button
5. Clicking Run on a scheduled route triggers the API and shows a loading spinner
6. Status toggle works for both types
7. Schedule pill shows correct frequency info for scheduled routes
8. Stats columns show appropriate metrics per type
9. Search input filters by route name
10. Inactive routes show dimmed state
