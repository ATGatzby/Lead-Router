# Phase 5 — Routing Engine

**Duration:** Week 5–7
**Status:** ⬜ Not Started
**Depends on:** Phase 1 (scaffold), Phase 3 (Round Robin/Redis), Phase 4 (routing rules in DB)

---

## Goal
Build the Fastify-based routing engine that receives incoming record events from Salesforce, evaluates them against configured routing rules, determines the assignee, and writes back to Salesforce — all within 5 seconds (p95). This is the heart of the product.

---

## Deliverables
- [ ] Fastify webhook receiver endpoint with HMAC signature validation
- [ ] Idempotency deduplication via Redis
- [ ] Rule evaluation engine (condition evaluator for all field types/operators)
- [ ] Round Robin atomic assignment (from Phase 3)
- [ ] SFDC OwnerId update via jsforce
- [ ] BullMQ retry queue (3 retries, exponential backoff)
- [ ] Dead-letter queue (DLQ) — persist failed routings, surface in UI
- [ ] Routing log persistence on every event
- [ ] Dry-run mode (evaluate without writing to SFDC)
- [ ] Soft-fail on no-match (log as "unmatched", no crash)

---

## PRD Requirements Coverage

| ID | Requirement | Priority |
|---|---|---|
| RE-01 | < 5 second end-to-end routing latency (p95) | P0 |
| RE-02 | Concurrent routing without race conditions on RR pointers | P0 |
| RE-03 | Retry queue: 3 retries with exponential backoff | P0 |
| RE-04 | Dead-letter queue surfaced in UI as "Failed Routings" | P0 |
| RE-05 | Idempotency: deduplicate duplicate SFDC events | P0 |
| RE-06 | Routing log: record ID, object, rule, assignee, timestamp, status | P0 |
| RE-07 | Soft-fail on no-match: log as "unmatched", no error | P0 |
| RE-08 | Dry-run mode: evaluate + log, no SFDC write | P1 |
| RE-09 | Outbound webhook on routing event (customer-configured) | P2 |

---

## Engine Architecture

```
Salesforce Org
  │  POST /route  (JSON payload + HMAC signature)
  ▼
┌─────────────────────────────────────────────────────────────┐
│                    Fastify Engine                            │
│                                                              │
│  1. Validate HMAC signature                                  │
│  2. Check Redis idempotency key (skip if duplicate)          │
│  3. Load active rules for object type (priority order)       │
│  4. Evaluate each rule's conditions against payload          │
│  5. First match found:                                       │
│     a. USER → assign directly                                │
│     b. ROUND_ROBIN → Redis atomic pointer → get member       │
│     c. QUEUE → assign queue ID directly                      │
│  6. Call SFDC REST API: PATCH /sobjects/{Object}/{id}         │
│     { "OwnerId": "005..." }                                  │
│  7. Write routing log (SUCCESS)                              │
│  8. If SFDC call fails → enqueue retry job (BullMQ)          │
│                                                              │
│  No match found:                                             │
│  → Write routing log (UNMATCHED)                             │
│  → No error thrown                                           │
└─────────────────────────────────────────────────────────────┘
         │                    ▲
         │ BullMQ queue        │ retry (up to 3x)
         ▼                    │
    Redis Queue ──────────────┘
         │
         │ all retries exhausted
         ▼
    Dead-Letter Queue (persist to routing_logs as FAILED)
```

---

## Incoming Payload Format (from SFDC Apex Trigger)

```json
{
  "orgId": "org_abc123",
  "objectType": "LEAD",
  "eventType": "INSERT",
  "recordId": "00Q5g00000AbCdEFAZ",
  "timestamp": "2026-02-23T10:30:00Z",
  "fields": {
    "LeadSource": "Web",
    "AnnualRevenue": 150000,
    "Status": "New",
    "Industry": "Technology",
    "Country": "India",
    "Rating": "Hot"
  }
}
```

---

## HMAC Signature Validation

Each SFDC org is issued a unique webhook secret at setup time (stored in `organizations` table). The Apex trigger includes this in the `X-Webhook-Signature` header.

```typescript
// apps/engine/src/middleware/validate-signature.ts
import crypto from 'crypto'

export function validateHmac(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex')
  return crypto.timingSafeEqual(
    Buffer.from(`sha256=${expected}`),
    Buffer.from(signature)
  )
}
```

---

## Idempotency

Prevent duplicate routing if the same SFDC event fires twice (network retry, Salesforce at-least-once delivery):

```typescript
// apps/engine/src/idempotency.ts
const key = `idem:${orgId}:${recordId}:${eventType}:${timestamp}`
const exists = await redis.set(key, '1', 'NX', 'EX', 3600)  // 1 hour TTL
if (!exists) {
  logger.info('Duplicate event — skipped', { key })
  return { status: 'duplicate' }
}
```

---

## Condition Evaluator

```typescript
// apps/engine/src/evaluator.ts

type Record = Record<string, unknown>

export function evaluateRule(record: Record, rule: RuleWithConditions): boolean {
  if (rule.conditions.length === 0) return true  // catch-all rule

  // Group conditions by groupId
  const groups = groupBy(rule.conditions, 'groupId')

  // Each group: all conditions connected by their conjunction (AND/OR within group)
  // Between groups: OR logic
  return Object.values(groups).some(group => evaluateGroup(record, group))
}

function evaluateGroup(record: Record, conditions: RuleCondition[]): boolean {
  // Within a group: AND logic (all must match)
  return conditions.every(c => evaluateCondition(record, c))
}

function evaluateCondition(record: Record, c: RuleCondition): boolean {
  const value = record[c.fieldName]

  switch (c.operator) {
    case 'equals':       return String(value ?? '') === c.value
    case 'not_equals':   return String(value ?? '') !== c.value
    case 'contains':     return String(value ?? '').includes(c.value)
    case 'not_contains': return !String(value ?? '').includes(c.value)
    case 'starts_with':  return String(value ?? '').startsWith(c.value)
    case 'is_blank':     return value === null || value === undefined || value === ''
    case 'is_not_blank': return value !== null && value !== undefined && value !== ''
    case 'gt':           return Number(value) > Number(c.value)
    case 'lt':           return Number(value) < Number(c.value)
    case 'gte':          return Number(value) >= Number(c.value)
    case 'lte':          return Number(value) <= Number(c.value)
    case 'includes':     return String(value ?? '').split(';').includes(c.value)
    case 'excludes':     return !String(value ?? '').split(';').includes(c.value)
    case 'is_true':      return value === true || value === 'true'
    case 'is_false':     return value === false || value === 'false'
    case 'before':       return new Date(String(value)) < new Date(c.value)
    case 'after':        return new Date(String(value)) > new Date(c.value)
    case 'within_last': {
      const days = Number(c.value)
      const cutoff = new Date(Date.now() - days * 86400000)
      return new Date(String(value)) >= cutoff
    }
    default: return false
  }
}
```

---

## BullMQ Retry Queue

```typescript
// apps/engine/src/queue.ts
import { Queue, Worker } from 'bullmq'

export const routingQueue = new Queue('routing-retries', { connection: redis })

export const routingWorker = new Worker(
  'routing-retries',
  async (job) => {
    const { orgId, recordId, objectType, ownerId } = job.data
    await updateSfdcOwner(orgId, recordId, objectType, ownerId)
  },
  {
    connection: redis,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,  // 2s → 8s → 32s
    },
  }
)

routingWorker.on('failed', async (job, err) => {
  if (job && job.attemptsMade >= 3) {
    // All retries exhausted → persist to DLQ (routing_logs with status FAILED)
    await prisma.routingLog.update({
      where: { id: job.data.logId },
      data: {
        status: 'FAILED',
        errorMessage: err.message,
        retryCount: job.attemptsMade,
      },
    })
  }
})
```

---

## SFDC Owner Update

```typescript
// packages/sfdc/src/update-owner.ts
export async function updateOwner(
  conn: Connection,
  objectType: string,   // 'Lead', 'Contact', 'Account'
  recordId: string,
  ownerId: string       // SFDC User ID (15 or 18 char) or Queue ID
): Promise<void> {
  await conn.sobject(objectType).update({
    Id: recordId,
    OwnerId: ownerId,
  })
}
```

---

## Routing Log Entry

Every routing event persists a log entry immediately (before SFDC callback):

```typescript
const log = await prisma.routingLog.create({
  data: {
    orgId,
    sfdcRecordId: payload.recordId,
    objectType: payload.objectType,
    eventType: payload.eventType,
    ruleId: matchedRule?.id ?? null,
    ruleName: matchedRule?.name ?? null,
    assigneeId: assignee?.id ?? null,
    assigneeName: assignee?.name ?? null,
    assignmentType: matchedRule?.assignmentType ?? null,
    status: 'RETRY',  // updated to SUCCESS or FAILED after SFDC call
  },
})
```

---

## Dry-Run Mode

If `rule.isDryRun === true`:
- Evaluate conditions as normal
- Determine assignee as normal
- **Skip** the SFDC OwnerId update
- Log with status `SUCCESS` but add `isDryRun: true` flag to log

---

## Performance Targets

| Step | Target |
|---|---|
| HMAC validation | < 1ms |
| Redis idempotency check | < 2ms |
| DB rule load (cached) | < 10ms |
| Condition evaluation (50 conditions) | < 5ms |
| Redis RR pointer increment | < 2ms |
| SFDC API call (OwnerId update) | < 2000ms (p95) |
| **Total end-to-end** | **< 5000ms (p95)** |

Rule caching: Load active rules into memory on startup and invalidate via Redis pub/sub when a rule is saved in the web app. Avoids a DB query per routing event.

---

## Key Files

| File | Purpose |
|---|---|
| `apps/engine/src/server.ts` | Fastify server, plugin registration |
| `apps/engine/src/routes/route.ts` | `POST /route` webhook handler |
| `apps/engine/src/evaluator.ts` | Condition evaluation logic |
| `apps/engine/src/router.ts` | Orchestration: load rules → evaluate → assign → log |
| `apps/engine/src/round-robin.ts` | Redis atomic pointer (Phase 3) |
| `apps/engine/src/queue.ts` | BullMQ worker + DLQ handler |
| `apps/engine/src/cache.ts` | In-memory rule cache + Redis invalidation |
| `packages/sfdc/src/update-owner.ts` | SFDC OwnerId update via jsforce |

---

## Verification Checklist
- [ ] `POST /route` with valid HMAC → routes record, logs SUCCESS
- [ ] `POST /route` with invalid HMAC → returns 401
- [ ] Send duplicate event (same recordId+timestamp) → second is deduplicated, no double-assign
- [ ] Record matches zero rules → logs UNMATCHED, no error thrown
- [ ] SFDC API call fails (mock 500) → job enqueued to BullMQ
- [ ] Job retries 3 times with increasing delays → after 3rd failure, logs FAILED in DLQ
- [ ] Dry-run rule → conditions evaluated, assignee determined, no SFDC write, SUCCESS log
- [ ] Concurrent: 20 simultaneous events to same Round Robin team → no duplicate SFDC owner assignments
- [ ] End-to-end latency with real SFDC org < 5 seconds (measure with timestamps in logs)
