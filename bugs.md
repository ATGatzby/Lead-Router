# Bug Audit Report
Generated: 2026-03-14
Auditor: bug-hunter agent

## Summary
- Critical: 0 (2 fixed)
- High: 0 (5 fixed)
- Medium: 0 (5 fixed)
- Low: 2 (1 fixed)
- Info: 4

---

## Low

### [BUG-013] `as any` casts in `health/recursive/route.ts` for Prisma enum values
- **File**: `apps/web/app/api/health/recursive/route.ts:18-33,72`
- **Category**: Code Quality
- **Description**: `COOLDOWN_SKIPPED` and `STAMP_SKIPPED` status values are cast as `as any` when passed to Prisma's `where.status` filter. This means Prisma will not validate these values at compile time; if the enum is renamed or these statuses are removed from the schema, the code silently queries nothing instead of producing a type error. These statuses appear to be recently added and not yet added to the Prisma schema enum.
- **Evidence**: `where: { orgId, status: "COOLDOWN_SKIPPED" as any, ... }`
- **Suggested Fix**: Add `COOLDOWN_SKIPPED` and `STAMP_SKIPPED` to the `RoutingStatus` enum in `packages/db/prisma/schema.prisma` so the Prisma client generates typed values.
- **Status**: Requires human decision — fix requires modifying `prisma/schema.prisma` and running a migration
- **Phase Found**: Phase 5

### [BUG-014] `rules/route.ts` uses `(r as any).routeType` etc. for new schema fields
- **File**: `apps/web/app/api/rules/route.ts:125-135`
- **Category**: Code Quality
- **Description**: Multiple new fields (`routeType`, `scheduleFrequency`, `scheduleTime`, `scheduleTimezone`, `searchCriteria`, `lastRunAt`, etc.) are accessed via `(r as any).fieldName ?? defaultValue`. This indicates these fields exist in the DB schema but haven't been added to the Prisma `select` clause of the `findMany` query that builds the rule list response. They are never returned unless the query fetches all columns (which it appears to via spread).
- **Evidence**: `routeType: (r as any).routeType ?? "REALTIME", scheduleFrequency: (r as any).scheduleFrequency ?? null, ...`
- **Suggested Fix**: Add all new fields explicitly to the Prisma `select` clause in the rules `findMany` query so TypeScript can type-check them without `as any` casts.
- **Status**: Requires human decision — depends on Prisma client regeneration with new schema fields; `as any` casts are intentional until schema is finalized
- **Phase Found**: Phase 5

---

## Info

### [INFO-001] TypeScript type errors in test files are non-blocking
- `apps/web/app/api/teams/[id]/route.test.ts` — mock object types are partial and missing required Prisma fields. Tests still pass since vitest is not type-checked by default.
- `apps/engine/src/router.test.ts` — `routeType: string | undefined` not assignable to `CachedRule`. Same cause: partial mock objects.
- These are test-only and do not affect production runtime behavior.

### [INFO-002] All 987 tests pass — no failing tests
- Phase 2 test run: 65 test files, 987 tests, 0 failures. Some tests emit expected `stderr` output (auth error messages) which is intentional behavior.

### [INFO-003] `dateTrunc` interpolation in analytics SQL is safe
- In `apps/web/app/api/analytics/volume/route.ts`, `dateTrunc` is derived from a validated allowlist (`VALID_GRANULARITY` set: `"day"`, `"week"`, `"month"`) before being interpolated into `DATE_TRUNC('${dateTrunc}', ...)`. The interpolation is not a SQL injection risk.

### [INFO-004] VPS credentials present in agent memory
- The project's auto-memory (`MEMORY.md`) contains VPS root password, IP address, and DB password in plaintext. This is in a local Claude Code memory file and not committed to git, but any tool with filesystem access on the developer's machine could read it. Consider storing these in a password manager instead.

---

## Previously Reported (Fixed)

### [BUG-001] Engine `/preview-count` and `/run-scheduled` endpoints lack authentication
- **File**: `apps/engine/src/routes/scheduled.ts`
- **Category**: Auth Bypass (Critical)
- **Fixed**: Added `app.addHook("onRequest", validateInternalToken)` to `scheduledPlugin`, matching the `analyticsPlugin` pattern.

### [BUG-002] `session.destroy()` not awaited — stale session cookie not cleared
- **File**: `apps/web/proxy.ts:88`
- **Category**: Security (Critical)
- **Fixed**: Added `await` to `session.destroy()` call so the cookie-clearing header is written before the response returns.

### [BUG-003] SOQL injection via unvalidated `value` in `within_last` operator
- **File**: `apps/web/lib/build-soql.ts:119`
- **Category**: Security (High)
- **Fixed**: Added `/^\d+$/` validation on `value` before interpolation into `LAST_N_DAYS:` literal; defaults to `"1"` if invalid.

### [BUG-004] Engine type error: `updateOwner` and `mergeLead` missing from `@lead-routing/sfdc` exports at compile time
- **File**: `packages/sfdc/src/index.ts`
- **Category**: Crash (High)
- **Fixed**: Added `.js` extensions to all 12 relative re-exports in `packages/sfdc/src/index.ts`.

### [BUG-005] Engine `search-runner.ts` calls `routeRecord` without required `timestamp` field
- **File**: `apps/engine/src/search-runner.ts:61-67`
- **Category**: Crash (High)
- **Fixed**: Added `timestamp: new Date().toISOString()` to the `routeRecord` payload, fixing idempotency key uniqueness per run.

### [BUG-006] Engine `cache.ts` type error: `assignmentType` nullability mismatch causes silent mis-routing
- **File**: `apps/engine/src/cache.ts:12`, `apps/engine/src/router.ts:219`
- **Category**: Data Loss (High)
- **Fixed**: Changed `CachedBranch.assignmentType` type to `string | null` and added `?? ""` fallback in `resolveBranchAssignee` call.

### [BUG-007] SOQL injection in `analytics-queue.ts` conversion check — Lead IDs not sanitized before SOQL IN clause
- **File**: `apps/engine/src/analytics-queue.ts:175`
- **Category**: Security (High)
- **Fixed**: Added alphanumeric validation filter (`/^[a-zA-Z0-9]+$/`) before including IDs in SOQL IN clause.

### [BUG-008] `prisma.roundRobinTeam.update` in PUT `/api/teams/:id` does not scope by `orgId`
- **File**: `apps/web/app/api/teams/[id]/route.ts:125`
- **Category**: Data Loss (Medium)
- **Fixed**: Changed `where: { id }` to `where: { id, orgId }` to enforce org scoping at the DB layer.

### [BUG-009] `new Date(since)` in journey batch endpoint is unvalidated
- **File**: `apps/web/app/api/routing-logs/journey/batch/route.ts:48`
- **Category**: Crash (Medium)
- **Fixed**: Added `isNaN(sinceDate.getTime())` validation; returns 400 with error message for invalid date strings.

### [BUG-010] `cooldown.ts` creates its own Redis connection instead of using the shared singleton
- **File**: `apps/engine/src/cooldown.ts`
- **Category**: Infrastructure (Medium)
- **Fixed**: Replaced local `getRedis()` singleton with import of shared `redis` from `./redis.js`.

### [BUG-011] `ioredis` `SET key val "NX" "EX" ttl` overload not matching — type errors in `idempotency.ts`
- **File**: `apps/engine/src/idempotency.ts:18,34`
- **Category**: Crash (Medium)
- **Fixed**: Changed positional args from `"NX", "EX", TTL` to `"EX", TTL, "NX"` to match ioredis TypeScript overload signatures.

### [BUG-012] `validateInternalToken` silently allows all requests when `INTERNAL_API_KEY` is unset
- **File**: `apps/engine/src/middleware/validate-internal.ts:13-16`
- **Category**: Security (Medium)
- **Fixed**: Changed fail-open to fail-closed — returns 503 with error message when `INTERNAL_API_KEY` is not configured.

### [BUG-015] `apps/engine` and `packages/db` have missing `.js` extension imports throughout
- **File**: `packages/sfdc/src/index.ts`, `packages/db/src/index.ts`
- **Category**: Code Quality (Low)
- **Fixed**: Added `.js` extensions to all relative imports in both `packages/sfdc/src/index.ts` (12 exports) and `packages/db/src/index.ts` (3 exports).
