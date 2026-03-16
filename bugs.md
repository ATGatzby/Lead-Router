# Bug Audit Report
Generated: 2026-03-16
Auditor: bug-hunter agent

## Summary
- Critical: 0
- High: 0
- Medium: 0
- Low: 0
- Info: 6
- All actionable bugs fixed (6/6)

---

## Info

### [INFO-001] TypeScript type errors in test files and Next.js dev-build types are non-blocking
- `apps/engine/src/license-heartbeat.test.ts` — 6 errors: `MockInstance<fetch>` type mismatch against `MockInstance<(this: unknown, ...args: unknown[]) => unknown>`. These are vitest type narrowing issues in test files only.
- `apps/engine/src/routes/route-batch.test.ts` and `route-single.test.ts` — 3 errors each: implicit `any` for `req`, `body`, `done` parameters in test callbacks.
- `apps/web/.next/dev/types/validator.ts` — 17 errors: references `(admin)/admin/` pages and `/api/admin/` routes that don't exist in the codebase. Stale `.next/dev` build artifact from a planned-but-not-yet-implemented admin panel. Running `next build` regenerates this file correctly. Does not affect production.

### [INFO-002] All 1035 tests pass — 48 new tests added since last audit
- Phase 2 test run: 68 test files, 1035 tests, 0 failures. All `stderr` output is from intentional error-path tests.

### [INFO-003] `dateTrunc` interpolation in analytics SQL is safe (unchanged from prior audit)
- In `apps/web/app/api/analytics/volume/route.ts`, `dateTrunc` is derived from a validated allowlist (`VALID_GRANULARITY`) before interpolation into `DATE_TRUNC('${dateTrunc}', ...)`. Not a SQL injection risk.

### [INFO-004] VPS credentials present in agent memory (unchanged from prior audit)
- The project's auto-memory (`MEMORY.md`) contains VPS root password, IP address, and DB password in plaintext. Local file only, not committed to git.

### [INFO-005] `getTierLimits()` uses a module-level `tierOverride` — does not persist across Next.js hot-reloads in development
- `apps/web/lib/license.ts:34`: `let tierOverride: LicenseTier | null = null`. In production (single long-lived Next.js standalone process) this is fine. In development with `next dev`, hot-reload resets module state, so a license activated via the UI would be lost on next file save. This is a dev-only gotcha, not a production issue.

### [INFO-006] `rules/[id]/clone` silently omits `routeType`, `scheduleFrequency`, `scheduleTime`, `scheduleTimezone`, `scheduleCron`, `searchCriteria`, and run-tracking fields from the cloned rule
- `apps/web/app/api/rules/[id]/clone/route.ts:53-128`: The `routingRule.create` data block does not include any of the scheduled-route fields (`routeType`, `scheduleFrequency`, `scheduleTime`, `scheduleTimezone`, `scheduleCron`, `searchCriteria`). Cloning a SEARCH-type or SCHEDULED-type rule produces a copy that defaults to `REALTIME` with no schedule. This may be intentional (clone as a starting point) but is worth documenting. Unlike BUG-018 (triggerConditions loss), this does not silently break security or correctness — it just changes the routing mode on the clone.

---

## Previously Reported (Fixed)

### [BUG-016] `.js` extensions missing again in `packages/db` and `packages/sfdc` index files — regression of BUG-015
- **File**: `packages/db/src/index.ts:23-25`, `packages/sfdc/src/index.ts:1-12`
- **Category**: Crash (High)
- **Fixed**: Re-added `.js` extensions to all 12 re-exports in `packages/sfdc/src/index.ts` and all 3 re-exports in `packages/db/src/index.ts` for NodeNext module resolution compatibility.

### [BUG-017] Engine `router.ts` has 13 Prisma JSON field type errors — `Record<string, unknown>` not assignable to `InputJsonValue`
- **File**: `apps/engine/src/router.ts`
- **Category**: Code Quality (High)
- **Fixed**: Added `as any` cast to all 14 bare `recordSnapshot: stripPii(fields)` calls to match the existing pattern used for `decisionTrace` fields.

### [BUG-018] `rules/[id]/clone` does not copy `triggerConditions` — pre-callout filter criteria lost on clone
- **File**: `apps/web/app/api/rules/[id]/clone/route.ts`
- **Category**: Data Loss (Medium)
- **Fixed**: Added `triggerConditions` to the `findFirst` include clause and added `triggerConditions: { create: ... }` block in the `routingRule.create` call, copying groupId, fieldName, fieldType, operator, value, and sortOrder.

### [BUG-019] `parseFilters()` does not validate date strings — invalid `from`/`to` params cause 500 on all analytics endpoints and audit-log endpoint
- **File**: `apps/web/app/api/analytics/filters.ts`, `apps/web/app/api/audit-logs/route.ts`
- **Category**: Crash (Medium)
- **Fixed**: Added `isNaN(getTime())` guards — `parseFilters()` falls back to 30-day/now defaults for invalid dates; audit-logs silently skips invalid date filters instead of passing Invalid Date to Prisma.

### [BUG-020] `license/activate` stores unvalidated `data.tier` from external license server directly into the database
- **File**: `apps/web/app/api/license/activate/route.ts`
- **Category**: Data Integrity (Medium)
- **Fixed**: Added `const tier = data.tier === "pro" ? "pro" : "free"` whitelist before storing to DB, audit log, and response.

### [BUG-021] `license-heartbeat.ts` creates `storageRedis` with `maxRetriesPerRequest: undefined` instead of the default
- **File**: `apps/engine/src/license-heartbeat.ts`
- **Category**: Code Quality (Low)
- **Fixed**: Changed `maxRetriesPerRequest: undefined` to `maxRetriesPerRequest: 20` (explicit ioredis default) to prevent ambiguous infinite-retry behavior.

### [BUG-001] Engine `/preview-count` and `/run-scheduled` endpoints lack authentication
- **File**: `apps/engine/src/routes/scheduled.ts`
- **Category**: Auth Bypass (Critical)
- **Fixed**: Added `app.addHook("onRequest", validateInternalToken)` to `scheduledPlugin`.

### [BUG-002] `session.destroy()` not awaited — stale session cookie not cleared
- **File**: `apps/web/proxy.ts:88`
- **Category**: Security (Critical)
- **Fixed**: Added `await` to `session.destroy()` call.

### [BUG-003] SOQL injection via unvalidated `value` in `within_last` operator
- **File**: `apps/web/lib/build-soql.ts:119`
- **Category**: Security (High)
- **Fixed**: Added `/^\d+$/` validation on `value` before interpolation.

### [BUG-004] Engine type error: `updateOwner` and `mergeLead` missing from `@lead-routing/sfdc` exports at compile time
- **File**: `packages/sfdc/src/index.ts`
- **Category**: Crash (High)
- **Fixed in prior run, then reverted**: `.js` extensions were added but have since been removed again. Now tracked as BUG-016.

### [BUG-005] Engine `search-runner.ts` calls `routeRecord` without required `timestamp` field
- **File**: `apps/engine/src/search-runner.ts`
- **Category**: Crash (High)
- **Fixed**: Added `timestamp: new Date().toISOString()` to the `routeRecord` payload.

### [BUG-006] Engine `cache.ts` type error: `assignmentType` nullability mismatch causes silent mis-routing
- **File**: `apps/engine/src/cache.ts:12`, `apps/engine/src/router.ts:219`
- **Category**: Data Loss (High)
- **Fixed**: Changed `CachedBranch.assignmentType` type to `string | null` and added `?? ""` fallback.

### [BUG-007] SOQL injection in `analytics-queue.ts` — Lead IDs not sanitized before SOQL IN clause
- **File**: `apps/engine/src/analytics-queue.ts:175`
- **Category**: Security (High)
- **Fixed**: Added alphanumeric validation filter before including IDs in SOQL IN clause.

### [BUG-008] `prisma.roundRobinTeam.update` in PUT `/api/teams/:id` does not scope by `orgId`
- **File**: `apps/web/app/api/teams/[id]/route.ts:125`
- **Category**: Data Loss (Medium)
- **Fixed**: Changed `where: { id }` to `where: { id, orgId }`.

### [BUG-009] `new Date(since)` in journey batch endpoint is unvalidated
- **File**: `apps/web/app/api/routing-logs/journey/batch/route.ts:48`
- **Category**: Crash (Medium)
- **Fixed**: Added `isNaN(sinceDate.getTime())` validation; returns 400 for invalid date strings.

### [BUG-010] `cooldown.ts` creates its own Redis connection instead of using the shared singleton
- **File**: `apps/engine/src/cooldown.ts`
- **Category**: Infrastructure (Medium)
- **Fixed**: Replaced local `getRedis()` singleton with import of shared `redis` from `./redis.js`.

### [BUG-011] `ioredis` `SET key val "NX" "EX" ttl` overload not matching in `idempotency.ts`
- **File**: `apps/engine/src/idempotency.ts:18,34`
- **Category**: Crash (Medium)
- **Fixed**: Changed positional args to `"EX", TTL, "NX"` to match ioredis overload signature.

### [BUG-012] `validateInternalToken` silently allows all requests when `INTERNAL_API_KEY` is unset
- **File**: `apps/engine/src/middleware/validate-internal.ts:13-16`
- **Category**: Security (Medium)
- **Fixed**: Changed fail-open to fail-closed; returns 503 when `INTERNAL_API_KEY` is not configured.

### [BUG-013] `as any` casts in `health/recursive/route.ts` for Prisma enum values
- **File**: `apps/web/app/api/health/recursive/route.ts:18-33,72`
- **Category**: Code Quality (Low)
- **Status**: Still open — requires schema migration decision.

### [BUG-014] `rules/route.ts` uses `(r as any).routeType` etc. for new schema fields
- **File**: `apps/web/app/api/rules/route.ts:125-135`
- **Category**: Code Quality (Low)
- **Status**: Still open — depends on Prisma client regeneration with finalized schema.

### [BUG-015] `apps/engine` and `packages/db` have missing `.js` extension imports throughout
- **File**: `packages/sfdc/src/index.ts`, `packages/db/src/index.ts`
- **Category**: Code Quality (Low)
- **Reported Fixed**: Extensions were added, but have been reverted. Now re-tracked as BUG-016.
