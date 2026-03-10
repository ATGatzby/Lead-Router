# Security Remediation — Implementation Plan

## Context
The security audit identified 27 vulnerabilities across the Lead Routing codebase (5 Critical, 7 High, 10 Medium, 5 Low). This plan remediates all findings in priority order across 5 phases. Each phase is designed so earlier fixes don't break later ones.

Reference: `Security Audit Report — Lead Routing.md` for full finding details.

---

## Phase 1: IMMEDIATE — Secrets & Network Exposure (C1, C2, H3)

### C1: Secrets in Git History
- **Files**: `lead-routing/.env.web`, `lead-routing/.env.engine`, `lead-routing/lead-routing.json`
- Add to `.gitignore`: `lead-routing/.env.*`, `lead-routing/lead-routing.json`, `lead-routing/docker-compose.yml`
- Run `git rm --cached lead-routing/.env.web lead-routing/.env.engine lead-routing/lead-routing.json lead-routing/docker-compose.yml`
- Add `lead-routing/.env.example` with placeholder values (no real secrets)
- Document in README: "rotate all secrets if this repo was ever public"

### C2: PostgreSQL Exposed on 0.0.0.0
- **File**: `apps/cli/src/templates/docker-compose.ts`
- Change `ports: ["5432:5432"]` → `ports: ["127.0.0.1:5432:5432"]`
- This still allows CLI migrations via SSH tunnel to localhost

### H3: Web & Engine Ports on 0.0.0.0
- **File**: `apps/cli/src/templates/docker-compose.ts`
- Change web `ports: ["3000:3000"]` → `ports: ["127.0.0.1:3000:3000"]`
- Change engine `ports: ["3001:3001"]` → `ports: ["127.0.0.1:3001:3001"]`
- Caddy reverse proxies to these — public access goes through Caddy only

---

## Phase 2: URGENT — Injection, Auth & Rate Limiting (C3, C4, C5, H1)

### C3: SOQL Injection in Router
- **File**: `apps/engine/src/router.ts` (lines 185–221)
- Current: string interpolation with `replace(/'/g, "\\'")` — insufficient
- Fix: replace raw SOQL with jsforce parameterized `.find()` / `.retrieve()` calls
- `getOwnerIdForUser()` → `conn.sobject('User').findOne({ Username: username }, ['Id'])`
- `getOwnerIdForQueue()` → `conn.sobject('Group').findOne({ DeveloperName: name, Type: 'Queue' }, ['Id'])`
- Remove the `escapeSoql()` helper entirely

### C4: Unauthenticated Analytics Endpoints
- **File**: `apps/engine/src/routes/analytics.ts`
- New file: `apps/engine/src/middleware/validate-internal.ts`
- Add Bearer token auth: engine checks `Authorization: Bearer <INTERNAL_API_KEY>` header
- `INTERNAL_API_KEY` = new env var (generated in CLI init, shared between web & engine `.env` files)
- Web's analytics page sends this token when calling engine analytics endpoints
- **Template updates**: `apps/cli/src/templates/env-engine.ts`, `apps/cli/src/templates/env-web.ts`

### C5: Spoofable X-Sfdc-Org-Id on Public Endpoints
- **Files**: `apps/web/app/api/setup/status/route.ts`, `apps/web/app/api/setup/onboarding-done/route.ts`, `apps/web/app/api/fields/sync/route.ts`
- New file: `apps/web/lib/validate-sfdc-hmac.ts`
- Pattern: Apex sends `X-Signature-256: sha256=<hex>` using org's `webhookSecret`
- Middleware: compute HMAC of request body with org's `webhookSecret`, compare with `crypto.timingSafeEqual`
- **Apex update**: `apps/cli/sfdc-package/force-app/main/default/classes/OnboardingController.cls`
  - Add HMAC header to `checkConnectionStatus`, `syncFields`, `markOnboardingDone` callouts
  - Reuse existing `hmacHex()` method already in the class
- **CRITICAL — CLI sfdc deploy must set `Webhook_Secret__c`**: The `sfdc deploy` step already sets `Engine_Endpoint__c` via `sf data update record`. It must ALSO set `Webhook_Secret__c` so Apex can compute HMAC from the very first onboarding callout (before OAuth completes).

### H1: No Rate Limiting
- New file: `apps/web/lib/rate-limit.ts`
- Sliding window using existing Redis singleton (`apps/web/lib/redis.ts`)
- Algorithm: `INCR key` + `EXPIRE key <window>` — simple and effective
- Apply to: login (`/api/auth/login`), OAuth callback, retry endpoints
- Limits: 10 req/min for login, 30 req/min for API endpoints
- Return `429 Too Many Requests` with `Retry-After` header
- New file: `apps/engine/src/middleware/rate-limit.ts` — same pattern for engine `/route` endpoint (100 req/min per org)

---

## Phase 3: SOON — CSRF, SSRF, Secrets Visibility (H2, H4, H5, H6, H7)

### H2: Missing CSRF Protection
- **File**: `apps/web/lib/session.ts`
- Add `sameSite: "lax"` to `cookieOptions`
- **File**: `apps/web/proxy.ts`
- Add Origin header validation for mutating requests (POST/PUT/DELETE/PATCH)
- Compare `Origin` header against `APP_URL` — reject mismatches with 403
- **CRITICAL — Skip Origin check for PUBLIC_PREFIXES routes**: Salesforce Apex callouts don't send browser `Origin` headers. These routes (`/api/setup/*`, `/api/fields/sync`) use HMAC auth (C5), not session cookies. Origin validation must only apply to session-authenticated routes.

### H4: SSRF via Webhook URL
- **File**: `apps/engine/src/webhook.ts`
- New file: `apps/engine/src/lib/ssrf-guard.ts`
- Before fetching webhook URL: resolve hostname via `dns.promises.resolve4()`
- Block private IP ranges: `10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `169.254.x`, `0.0.0.0`, `::1`
- Block `metadata.google.internal`, `169.254.169.254` (cloud metadata)
- Apply to webhook dispatch before `fetch(url)`

### H5: Webhook Secret Readable in Custom Settings
- **File**: `apps/cli/sfdc-package/force-app/main/default/customSettings/Routing_Settings__c.object-meta.xml`
- Change `<visibility>Public</visibility>` → `<visibility>Protected</visibility>`
- Only Apex code and admins can read — no access from formulas/flows/reports

### H6: CSV Formula Injection
- New file: `apps/web/lib/csv.ts`
- Sanitize function: if cell starts with `=`, `+`, `-`, `@`, `\t`, `\r`, prefix with single quote `'`
- Apply in any CSV export endpoint (activity export)

### H7: Plaintext Admin Password in .env
- **File**: `apps/cli/src/steps/seed-database.ts`
- After successful seed: remove `ADMIN_PASSWORD` line from `.env.web`
- Password is already hashed (PBKDF2) in DB — plaintext no longer needed
- **File**: `apps/cli/src/templates/env-web.ts` — add comment: `# removed after seed`

---

## Phase 4: PLANNED — Hardening (M1–M10)

### M1: OAuth State Parameter
- **File**: `apps/web/app/api/auth/sfdc/route.ts`
- Generate random `state` param, store in iron-session, validate on callback

### M2: Header Injection in Proxy
- **File**: `apps/web/proxy.ts`
- Strip `\r\n` from header values before forwarding

### M3: No RBAC
- **File**: `apps/web/lib/auth.ts`
- Add role check helper: `requireRole(session, 'admin')`
- Apply to destructive endpoints (delete rules, manage users, settings)

### M4: Admin Role Default on Registration
- **File**: `apps/web/app/api/auth/register/route.ts`
- New users get `member` role, not `admin`
- First user (from CLI seed) remains `admin`

### M5: Docker Containers Run as Root
- **Files**: `apps/web/Dockerfile`, `apps/engine/Dockerfile`
- Add `RUN addgroup -S app && adduser -S app -G app` in runner stage
- Add `USER app` before `CMD`

### M6: No Security Headers
- **File**: `apps/cli/src/templates/caddy.ts`
- Add to Caddyfile template:
  ```
  header {
    X-Content-Type-Options nosniff
    X-Frame-Options DENY
    Referrer-Policy strict-origin-when-cross-origin
    Permissions-Policy interest-cohort=()
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
  }
  ```

### M7: No Input Validation
- New file: `apps/engine/src/lib/schemas.ts` (Zod)
- Validate `/route` request body: `orgId`, `recordId`, `objectType`, `fields`
- New file: `apps/web/lib/schemas.ts` (Zod)
- Validate login, register, rule create/update payloads
- **IMPORTANT**: Derive schemas from actual request shapes by reading existing handler code — don't invent constraints. Use `.passthrough()` where needed to avoid rejecting unexpected-but-harmless fields.

### M8: PII in Record Snapshots
- **File**: `apps/engine/src/router.ts`
- Strip sensitive fields (Email, Phone, SSN patterns) before storing `recordSnapshot`
- Allowlist approach: only store field names used in routing rules + standard Id fields

### M9: Apex Without Permission Checks
- **File**: `apps/cli/sfdc-package/force-app/main/default/classes/OnboardingController.cls`
- **ADJUSTED**: Use `Routing_Settings__c.SObjectType.getDescribe().isAccessible()` check instead of custom permissions — System Admins pass automatically, no permission set assignment needed (which can't be deployed via metadata)
- Add access check to each `@AuraEnabled` method, throw `AuraHandledException` if not accessible

### M10: --no-frozen-lockfile in Dockerfiles
- **Files**: `apps/web/Dockerfile`, `apps/engine/Dockerfile`
- Change `pnpm install --no-frozen-lockfile` → `pnpm install --frozen-lockfile`
- **NOTE**: Ensure `pnpm-lock.yaml` is committed and in sync before this change, or Docker builds will fail

---

## Phase 5: BACKLOG — Low Severity (L1–L5)

### L1: No Token Age Check
- **File**: `apps/web/lib/auth.ts`
- Add `issuedAt` to session, reject tokens older than 30 days

### L2: HTML Injection in Feedback Email
- **File**: `apps/web/app/api/feedback/route.ts` (if exists)
- Escape HTML entities in user-supplied text before rendering

### L3: Open Redirect
- **File**: `apps/web/proxy.ts`
- Validate redirect targets against allowlist (`APP_URL` origin only)

### L4: Redis Without Auth
- **File**: `apps/cli/src/templates/docker-compose.ts`
- Add `command: redis-server --requirepass ${REDIS_PASSWORD}`
- Update Redis connection strings in `.env.web` and `.env.engine`

### L5: Verbose Error Messages
- **Files**: `apps/web/proxy.ts`, `apps/engine/src/routes/*.ts`
- Return generic errors to client, log details server-side only

---

## New Files Summary

| File | Phase | Purpose |
|------|-------|---------|
| `apps/engine/src/middleware/validate-internal.ts` | 2 | Bearer token auth for analytics |
| `apps/web/lib/validate-sfdc-hmac.ts` | 2 | HMAC validation for SFDC-origin requests |
| `apps/web/lib/rate-limit.ts` | 2 | Redis sliding-window rate limiter (web) |
| `apps/engine/src/middleware/rate-limit.ts` | 2 | Rate limiter (engine) |
| `apps/engine/src/lib/ssrf-guard.ts` | 3 | Private IP blocking for webhooks |
| `apps/web/lib/csv.ts` | 3 | CSV formula injection sanitizer |
| `apps/engine/src/lib/schemas.ts` | 4 | Zod schemas for engine input validation |
| `apps/web/lib/schemas.ts` | 4 | Zod schemas for web input validation |
| _(M9 uses isAccessible() — no new file needed)_ | 4 | — |

## Modified Files Summary

| File | Phases | Changes |
|------|--------|---------|
| `apps/cli/src/templates/docker-compose.ts` | 1, 5 | Bind ports to 127.0.0.1, Redis auth |
| `apps/engine/src/router.ts` | 2, 4 | jsforce `.find()`, PII stripping |
| `apps/engine/src/routes/analytics.ts` | 2 | Add auth middleware |
| `apps/engine/src/webhook.ts` | 3 | SSRF guard |
| `apps/web/lib/session.ts` | 3 | sameSite: "lax" |
| `apps/web/proxy.ts` | 3, 4, 5 | CSRF, header injection, open redirect, error messages |
| `apps/cli/sfdc-package/.../OnboardingController.cls` | 2, 4 | HMAC headers, permission checks |
| `apps/web/Dockerfile`, `apps/engine/Dockerfile` | 4 | Non-root user, frozen lockfile |
| `apps/cli/src/templates/caddy.ts` | 4 | Security headers |
| `apps/cli/src/templates/env-engine.ts` | 2 | INTERNAL_API_KEY |
| `apps/cli/src/templates/env-web.ts` | 2 | INTERNAL_API_KEY |
| `.gitignore` | 1 | Exclude lead-routing/ secrets |

---

## Verification

### Per-Phase Testing
- **Phase 1**: `git status` confirms tracked secrets removed; `docker compose up` still works with 127.0.0.1 binds; CLI migrations via SSH tunnel still succeed
- **Phase 2**: Vitest unit tests for SOQL (jsforce mock), HMAC validation, rate limiter; manual test: unauthenticated analytics returns 401; SFDC onboarding wizard still works with HMAC
- **Phase 3**: Test CSRF by sending POST from different origin → 403; test SSRF with `http://127.0.0.1` webhook → blocked; CSV export with `=cmd()` cell → prefixed
- **Phase 4**: Docker images build with non-root; `curl -I` shows security headers; Zod rejects malformed payloads; Apex methods fail without custom permission
- **Phase 5**: Expired session redirects to login; Redis requires password; error responses are generic

### Regression
- Run full test suite after each phase: `pnpm test` from monorepo root
- Run `pnpm build` to verify no type errors
- End-to-end: `lead-routing init` on a test VPS, complete onboarding wizard, route a test lead
