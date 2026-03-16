# Bulk API 2.0 Implementation for Scheduled Search at Scale

## Context

Scheduled search triggers currently use the REST API (`conn.query()` + `conn.queryMore()`) with a hardcoded 50K record limit and load ALL results into memory before routing. This breaks at scale:
- 1M records = ~300MB RAM spike
- Match step fires 1-5 SFDC API calls **per record** (email, phone, domain, company lookups)
- No checkpointing — failures require full re-run
- No progress visibility for long-running searches

**Goal**: Handle 1M+ record scheduled searches via Salesforce Bulk API 2.0 streaming, batched match queries, and checkpoint-based progress tracking.

**Key finding**: jsforce `^2.0.0-beta.29` (already installed) supports `conn.bulk2.query(soql)` which returns a streaming `Parsable<Record>`. Bulk API 2.0 query jobs do NOT count against the 15K batch submission limit. Limit is 100M records/24h, 15GB per job.

---

## Architecture: Two-Tier Execution

```
runScheduledRoute(ruleId, orgId)
  │
  ├── COUNT query (REST, fast)
  │
  ├── count < 2,000 → REST path (existing, unchanged)
  │
  └── count >= 2,000 → BULK path (new)
        │
        ├── conn.bulk2.query(soql) → streaming records
        │
        ├── Buffer into micro-batches of 500
        │     │
        │     ├── batchMatchRecords() → 5 batch SOQL queries per 500 records
        │     │   (instead of 5 per record = 100x reduction in API calls)
        │     │
        │     └── Enqueue micro-batch to bulk-search-queue (BullMQ)
        │           └── Worker calls routeRecord() per record
        │               (match step skipped — already pre-resolved)
        │
        ├── Redis checkpoint updated per micro-batch
        │
        └── BulkSearchRun DB row tracks final status
```

**API call reduction**: 1M records with match step = ~5M API calls (current) → ~10K API calls (batched). 500x improvement.

---

## Implementation Phases

### Phase 1: Schema — `packages/db/prisma/schema.prisma`

New model for tracking bulk runs:
```prisma
model BulkSearchRun {
  id               String    @id @default(cuid())
  orgId            String
  ruleId           String
  status           String    @default("RUNNING") // RUNNING | COMPLETE | FAILED | CANCELLED
  recordsFound     Int       @default(0)
  recordsProcessed Int       @default(0)
  recordsRouted    Int       @default(0)
  recordsFailed    Int       @default(0)
  recordsSkipped   Int       @default(0)
  error            String?
  startedAt        DateTime  @default(now())
  completedAt      DateTime?
  durationMs       Int?
  maxRecords       Int?
  batchSize        Int?
  org              Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  rule             RoutingRule  @relation(fields: [ruleId], references: [id], onDelete: Cascade)
  @@index([orgId, ruleId])
  @@index([ruleId, status])
  @@map("bulk_search_runs")
}
```

Add to `RoutingRule`:
- `searchMaxRecords Int?` — user-configurable cap (null = no limit)
- `searchBatchSize Int?` — micro-batch size (null = default 500)
- `bulkSearchRuns BulkSearchRun[]`

Add `bulkSearchRuns BulkSearchRun[]` to `Organization`.

Migration: `20260317000000_add_bulk_search_runs`

---

### Phase 2: SOQL Builder — `apps/engine/src/soql-builder.ts`

Small change — add `omitLimit` parameter (Bulk API 2.0 doesn't support LIMIT):

```typescript
export function buildSearchSOQL(
  objectType: string,
  criteria: SOQLConditionGroup[] | null,
  limit: number = 50000,
  omitLimit: boolean = false  // NEW
): string
```

When `omitLimit: true`, skip the `LIMIT` clause and add `ORDER BY Id ASC` (deterministic ordering).

---

### Phase 3: Router — `apps/engine/src/router.ts`

Minimal change — add `preResolvedMatch` to `RoutingPayload`:

```typescript
export interface RoutingPayload {
  // ... existing fields ...
  preResolvedMatch?: MatchResult | null;  // NEW — skip runMatcher() when set
}
```

In `routeNewStyle()` (~line 520), check before calling `runMatcher()`:

```typescript
if (payload.preResolvedMatch !== undefined) {
  matchResult = payload.preResolvedMatch;
} else {
  matchResult = await runMatcher(fields, rule.matchConfig, conn, recordId, orgId);
}
```

~10 lines changed. Core routing pipeline untouched.

---

### Phase 4: Batch Matcher — `apps/engine/src/batch-matcher.ts` (NEW, ~180 lines)

Replaces per-record match queries with batched SOQL:

```typescript
export async function batchMatchRecords(
  conn: Connection,
  records: Array<{ recordId: string; fields: Record<string, unknown> }>,
  matchConfig: CachedMatchConfig,
  orgId: string
): Promise<Map<string, MatchResult | null>>
```

Strategy:
1. Collect unique emails, phones, domains across all 500 records in the batch
2. Run batch SOQL with `IN` clauses (chunk to 200 values per query for SOQL length limits):
   - `SELECT Id, OwnerId, Email FROM Lead WHERE Email IN (...) AND IsConverted = false`
   - `SELECT Id, OwnerId, Email FROM Contact WHERE Email IN (...)`
   - `SELECT Id, OwnerId, Website FROM Account WHERE Website LIKE '%domain1%' OR ...`
3. Build lookup maps: `email → MatchResult`, `phone → MatchResult`, etc.
4. For each record, resolve match from maps in priority order (same as current `runMatcher`)
5. Company name: batch for STRICT mode only. FUZZY/AI_SMART fall back to per-record (with option to skip in bulk mode)

**Result**: 500 records → ~5 SOQL queries (vs. ~2,500 individual queries)

---

### Phase 5: Bulk Search Queue — `apps/engine/src/bulk-search-queue.ts` (NEW, ~100 lines)

BullMQ queue for processing micro-batches. Follows `batch-queue.ts` pattern:

- Queue name: `"bulk-search-routing"`
- Concurrency: 15
- Rate limiter: 30 jobs/sec
- Attempts: 2 (bulk runs can be re-run)
- Job data: `{ orgId, ruleId, runId, objectType, records: [{ recordId, fields, matchResult }] }`
- Worker: iterate records, call `routeRecord()` with `preResolvedMatch` set
- After processing, increment Redis counters: `HINCRBY bulk-run:{runId} routed {n}`

Register in `apps/engine/src/server.ts` with side-effect import.

---

### Phase 6: Bulk Search Runner — `apps/engine/src/bulk-search.ts` (NEW, ~200 lines)

Core streaming logic:

```typescript
export async function runBulkSearch(
  conn: Connection,
  soql: string,
  ruleId: string,
  orgId: string,
  opts: { maxRecords?: number; batchSize?: number; runId: string }
): Promise<RunResult>
```

Flow:
1. `conn.bulk2.query(soql)` → streaming `Parsable<Record>`
2. Buffer records in micro-batches of `batchSize` (default 500)
3. Per micro-batch:
   - Call `batchMatchRecords()` if match config exists
   - Enqueue to `bulk-search-queue`
   - Update Redis checkpoint: `HINCRBY bulk-run:{runId} processed 500`
   - Check cancel flag: `EXISTS bulk-run:{runId}:cancel`
4. **Back-pressure**: if queue depth > 10K pending jobs, pause stream until < 5K (prevents Redis OOM)
5. After stream ends, wait for all queued jobs to complete
6. Update `BulkSearchRun` DB row with final counts and status

---

### Phase 7: Search Runner — `apps/engine/src/search-runner.ts`

Modify `runScheduledRoute()` to add the two-tier decision:

```typescript
const BULK_THRESHOLD = 2000;

// 1. Count query first
const countResult = await conn.query(buildCountSOQL(objectType, searchCriteria));
const count = countResult.totalSize;

// 2. Stale run detection
const staleRun = await prisma.bulkSearchRun.findFirst({
  where: { ruleId, status: 'RUNNING', startedAt: { gt: sixHoursAgo } }
});
if (staleRun) return { status: 'SKIPPED', reason: 'Run already in progress' };

// 3. Route to appropriate path
if (count < BULK_THRESHOLD) {
  return runRestPath(conn, objectType, searchCriteria, ruleId, orgId);  // existing logic
} else {
  const run = await prisma.bulkSearchRun.create({ data: { orgId, ruleId, recordsFound: count } });
  const soql = buildSearchSOQL(objectType, searchCriteria, 0, true);  // omitLimit=true
  return runBulkSearch(conn, soql, ruleId, orgId, { runId: run.id, maxRecords, batchSize });
}
```

Existing REST path extracted to `runRestPath()` — no behavior change.

---

### Phase 8: Progress & Cancellation Endpoints — `apps/engine/src/routes/scheduled.ts`

Two new endpoints:

**`GET /bulk-run/:runId/status`**
- Read Redis hash `bulk-run:{runId}` → return `{ status, processed, routed, failed, estimatedTimeRemainingMs }`
- Fallback to DB `BulkSearchRun` row if Redis key expired
- Auth: `validateInternalToken`

**`POST /bulk-run/:runId/cancel`**
- Set Redis `bulk-run:{runId}:cancel = 1` (TTL 1 hour)
- Update `BulkSearchRun.status = 'CANCELLED'`
- Auth: `validateInternalToken`

---

### Phase 9: Web UI Changes

**`apps/web/components/route-builder/config/SearchTriggerConfigSheet.tsx`**
- Add "Max records per run" number input (maps to `searchMaxRecords`)
- Add "Batch size" dropdown: 200 / 500 / 1000 (maps to `searchBatchSize`)

**`apps/web/app/(dashboard)/routing-rules/page.tsx`**
- When a rule has a `RUNNING` BulkSearchRun, show progress bar polling `GET /bulk-run/:runId/status` via TanStack Query (`refetchInterval: 2000`)
- Add "Cancel" button calling `POST /bulk-run/:runId/cancel`
- Show records processed / total, estimated time remaining

---

## Files Summary

| File | Action | Lines |
|------|--------|-------|
| `packages/db/prisma/schema.prisma` | Edit — add BulkSearchRun model + RoutingRule fields | +30 |
| `apps/engine/src/soql-builder.ts` | Edit — add `omitLimit` param | +5 |
| `apps/engine/src/router.ts` | Edit — add `preResolvedMatch` to payload + skip matcher | +10 |
| `apps/engine/src/batch-matcher.ts` | **New** — batched match queries | ~180 |
| `apps/engine/src/bulk-search-queue.ts` | **New** — BullMQ queue for micro-batches | ~100 |
| `apps/engine/src/bulk-search.ts` | **New** — Bulk API 2.0 streaming orchestrator | ~200 |
| `apps/engine/src/search-runner.ts` | Edit — two-tier decision + stale run detection | +40 |
| `apps/engine/src/routes/scheduled.ts` | Edit — progress + cancel endpoints | +50 |
| `apps/engine/src/server.ts` | Edit — import bulk-search-queue | +1 |
| `apps/web/.../SearchTriggerConfigSheet.tsx` | Edit — max records + batch size inputs | +30 |
| `apps/web/.../routing-rules/page.tsx` | Edit — progress bar + cancel button | +40 |

---

## Implementation Order

1. Schema (Phase 1) → `prisma migrate dev`
2. SOQL builder (Phase 2) — independent, small
3. Router payload (Phase 3) — independent, small
4. Batch matcher (Phase 4) — depends on nothing
5. Bulk search queue (Phase 5) — depends on Phase 3
6. Server.ts import (Phase 5) — depends on Phase 5
7. Bulk search runner (Phase 6) — depends on Phases 4, 5
8. Search runner (Phase 7) — depends on Phase 6
9. Endpoints (Phase 8) — depends on Phase 6
10. Web UI (Phase 9) — depends on Phase 8

---

## Verification

1. **Unit tests**: Add tests for `batch-matcher.ts` (mock SOQL responses, verify map construction), `soql-builder.ts` (omitLimit flag)
2. **Integration test**: Mock `conn.bulk2.query()` stream, verify micro-batch creation and queue enqueue
3. **Scale test**: Run against a Salesforce sandbox with 10K+ records, verify:
   - Memory stays flat (no spike from loading all records)
   - Progress endpoint returns incrementing counts
   - Cancel stops processing within 1 micro-batch
   - Match results are correct (compare against per-record matcher on a sample)
4. **Existing tests pass**: `pnpm test` — 1035 tests should remain green
5. **Build**: `pnpm --filter @lead-routing/web build` + `pnpm --filter @lead-routing/engine build`

---

## Scale Estimates (1M records)

| Metric | REST (current) | Bulk API (new) |
|--------|---------------|----------------|
| Memory | ~300MB spike | ~50MB (streaming) |
| SFDC API calls (with match) | ~5,000,000 | ~10,000 |
| Time to complete | Would fail (50K limit) | ~15-30 min |
| Checkpointing | None | Per micro-batch |
| Progress visibility | None | Real-time polling |
