# Bulk API 2.0 Write-Back for SFDC Owner Updates

## Context

After routing determines "record X → owner Y", each record is updated individually via `updateOwner()` — 1 REST PATCH per record. At 10M records, that's 10M API calls against a 100K/day limit (100 days to complete). Salesforce Bulk API 2.0 ingest supports 100M records/day with auto-chunking into 10K batches. This change makes bulk search viable at scale.

**Key insight**: Separate the routing decision from the SFDC write. `routeRecord()` resolves the owner, collects assignments, then a single Bulk API 2.0 job writes them all.

---

## Phase 1: `packages/sfdc/src/update-owner.ts` — Add `bulkUpdateOwners()`

New function using jsforce Bulk API 2.0:

```typescript
export interface BulkUpdateRecord {
  Id: string;
  OwnerId: string;
  lrt__Routing_Action__c?: string;
}

export interface BulkUpdateResult {
  successful: string[];           // record IDs
  failed: Array<{ id: string; error: string }>;
  unprocessed: number;
}

export async function bulkUpdateOwners(
  conn: Connection,
  objectType: string,
  records: BulkUpdateRecord[],
  routingActionField?: string
): Promise<BulkUpdateResult>
```

- Uses `conn.bulk2.loadAndWaitForResults({ object, operation: 'update', input: records })`
- Includes `lrt__Routing_Action__c: 'assigned:{timestamp}'` to prevent recursive triggers
- If `INVALID_FIELD` error on routing action field, retry without it (same fallback as existing `updateOwner`)
- `pollTimeout: 300000` (5 min), `pollInterval: 5000`
- Returns successful IDs, failed IDs with errors, unprocessed count

Add tests: mock `conn.bulk2.loadAndWaitForResults`, verify CSV includes OwnerId + routing action, verify partial failure handling.

---

## Phase 2: `apps/engine/src/router.ts` — Add `skipSfdcWrite` flag

Add to `RoutingPayload`:
```typescript
export interface RoutingPayload {
  // ... existing fields ...
  skipSfdcWrite?: boolean;
  _assignments?: Array<{ recordId: string; ownerId: string; logId: string }>;
}
```

Guard all 8 `updateOwner` call sites (~lines 598, 631, 666, 699, 735, 768, 858, 941):

```typescript
// Before (current):
await updateOwner(conn, objectName, recordId, ownerId, ROUTING_ACTION_FIELD);

// After:
if (payload.skipSfdcWrite) {
  payload._assignments?.push({ recordId, ownerId, logId: log.id });
} else {
  await updateOwner(conn, objectName, recordId, ownerId, ROUTING_ACTION_FIELD);
}
```

When `skipSfdcWrite` is true:
- Routing log is still created (with `assigneeId` captured)
- Cooldown is still set (Redis)
- Round-robin counts still incremented
- Log status set to `RETRY` (pending bulk write) instead of `SUCCESS`
- Owner ID pushed to `_assignments` array for the caller to collect

When `skipSfdcWrite` is false (default): zero behavior change.

---

## Phase 3: `apps/engine/src/bulk-search-queue.ts` — Two-phase worker

Restructure the worker into: **decision phase** → **bulk write phase**

```typescript
// Phase A: Collect routing decisions
const assignments: Array<{ recordId: string; ownerId: string; logId: string }> = [];

for (const rec of job.data.records) {
  const payload: RoutingPayload = {
    orgId, objectType, eventType: "SEARCH",
    recordId: rec.recordId, fields: rec.fields, ruleId,
    preResolvedMatch: rec.matchResult,
    skipSfdcWrite: true,        // NEW — don't write to SFDC yet
    _assignments: assignments,  // NEW — collect assignments here
  };
  await routeRecord(payload, Date.now());
}

// Phase B: Bulk write all assignments in one API call
if (assignments.length > 0) {
  const conn = await getOrgConnection(orgId);
  const records = assignments.map(a => ({
    Id: a.recordId,
    OwnerId: a.ownerId,
    lrt__Routing_Action__c: `assigned:${new Date().toISOString()}`,
  }));

  const result = await bulkUpdateOwners(conn, objectType, records);

  // Reconcile: update routing logs based on write results
  if (result.successful.length > 0) {
    const successLogIds = assignments
      .filter(a => result.successful.includes(a.recordId))
      .map(a => a.logId);
    await prisma.routingLog.updateMany({
      where: { id: { in: successLogIds } },
      data: { status: "SUCCESS" },
    });
    routed += result.successful.length;
  }

  if (result.failed.length > 0) {
    const failedLogIds = assignments
      .filter(a => result.failed.some(f => f.id === a.recordId))
      .map(a => a.logId);
    await prisma.routingLog.updateMany({
      where: { id: { in: failedLogIds } },
      data: { status: "FAILED", errorMessage: "Bulk API write failed" },
    });
    failed += result.failed.length;
  }
}

// Update Redis counters
await redis.hincrby(`bulk-run:${runId}`, 'routed', routed);
await redis.hincrby(`bulk-run:${runId}`, 'failed', failed);
```

This turns 10K individual REST calls into **1 Bulk API job** per micro-batch.

---

## Phase 4: Progress endpoint — Add write phase tracking

**File**: `apps/engine/src/routes/scheduled.ts`

Update `GET /bulk-run/:runId/status` to include:
- `phase: "routing" | "writing" | "complete"` — so the UI shows what's happening
- `writePending: number` — records awaiting bulk write

The bulk-search-queue worker sets `HSET bulk-run:{runId} phase writing` before the bulk write call.

---

## Files Summary

| File | Action | Change Size |
|------|--------|-------------|
| `packages/sfdc/src/update-owner.ts` | Edit — add `bulkUpdateOwners()` | +60 lines |
| `packages/sfdc/src/update-owner.test.ts` | New — tests for bulk update | +80 lines |
| `apps/engine/src/router.ts` | Edit — add `skipSfdcWrite` + `_assignments` to payload, guard 8 call sites | +30 lines |
| `apps/engine/src/bulk-search-queue.ts` | Edit — two-phase worker (decision → bulk write → reconcile) | +50 lines |
| `apps/engine/src/routes/scheduled.ts` | Edit — add phase/writePending to status | +5 lines |

---

## Scale Impact

| Metric | Before (REST) | After (Bulk API 2.0) |
|--------|---------------|---------------------|
| API calls for 10M records | 10,000,000 | ~1,000 bulk jobs |
| Daily API limit concern | 100 days | **~10 minutes** |
| Time for 1M records | ~9 hours | **~5-10 minutes** |
| Partial failure handling | Per-record retry queue | Per-job with log reconciliation |

---

## Verification

1. Unit tests: `bulkUpdateOwners` with mocked jsforce, `routeRecord` with `skipSfdcWrite` flag
2. Integration: run full test suite `pnpm test` — existing 1078 tests must pass
3. Load test: `npx tsx scripts/load-test.ts -n 10000000 -b 10000 --with-matching false`
4. Build: `pnpm --filter @lead-routing/engine build` + `pnpm --filter @lead-routing/web build`
5. Deploy and verify on VPS
