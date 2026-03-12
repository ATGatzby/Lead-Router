# Security Audit Report — Lead Routing

> **Date:** 2026-03-10
> **Auditor:** Internal Security Review (Claude CSO)
> **Scope:** Full codebase — web app, routing engine, CLI, Salesforce package, Docker infrastructure
> **Total Findings:** 27 (5 Critical, 7 High, 10 Medium, 5 Low)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Critical Findings](#critical-findings)
3. [High Findings](#high-findings)
4. [Medium Findings](#medium-findings)
5. [Low Findings](#low-findings)
6. [Positive Findings](#positive-findings)
7. [Priority Remediation Order](#priority-remediation-order)

---

## Executive Summary

| Severity | Count | Key Themes |
|----------|-------|------------|
| CRITICAL | 5 | Secrets in git, exposed database, SOQL injection, unauthenticated endpoints |
| HIGH | 7 | No rate limiting, CSRF, port exposure, SSRF, CSV injection, plaintext admin password |
| MEDIUM | 10 | Missing OAuth state, no RBAC, Docker root, no security headers, no input validation |
| LOW | 5 | Token replay, HTML injection, open redirect, Redis no-auth, PII in logs |

The most urgent issues are **committed production secrets** (C1), **PostgreSQL exposed to the internet** (C2), and **SOQL injection** (C3). These should be remediated immediately.

---

## Critical Findings

### C1. Production Secrets Committed to Git History

**Files:** `lead-routing/.env.engine`, `lead-routing/.env.web`, `lead-routing/docker-compose.yml`
**Commit:** `8f24ac1`
**Remote:** `git@github.com:ATGatzby/Lead-Router.git`

**Description:** Real production secrets were committed before `.gitignore` was updated. They persist in git history on GitHub:

- PostgreSQL password (`fec89d4e98725239f20f324a7c1ae585` and `61d5c1ab199e25d64ff478336c64b243`)
- Salesforce Connected App client secret (`BA289C392CDD...`)
- Session secret (`15885aae423b...`)
- Admin secret (`6a1622766b49...`)
- Webhook secret (`5ac080fc19ed...`)

**Fix:**
1. `git rm --cached lead-routing/.env.engine lead-routing/.env.web lead-routing/docker-compose.yml lead-routing/lead-routing.json`
2. Rotate ALL secrets immediately (DB password, session secret, admin secret, webhook secret, SFDC client secret)
3. If the repo is/was public, use BFG Repo-Cleaner to purge history
4. Force-push the cleaned history

---

### C2. PostgreSQL Exposed to the Internet

**File:** `lead-routing/docker-compose.yml` line 24 — `ports: "5432:5432"`

**Description:** The deployed `docker-compose.yml` binds PostgreSQL to `0.0.0.0:5432`, exposing it to the entire internet. Combined with the committed password (C1), anyone can connect to the production database.

**Note:** The CLI template (`apps/cli/src/templates/docker-compose.ts` line 20) correctly uses `"127.0.0.1:5432:5432"` — this is a regression in the deployed file only.

**Fix:** Change to `"127.0.0.1:5432:5432"` and redeploy. Verify with `ss -tlnp | grep 5432` on the VPS.

---

### C3. SOQL Injection in Engine Matcher

**File:** `apps/engine/src/router.ts` lines 185–221

**Description:** User-controlled field values (Email, Phone, Company) from the webhook payload are interpolated directly into SOQL queries with only `replace(/'/g, "\\'")`. This is the **wrong escape** — SOQL requires `''` (doubled single quote), not `\'`. Additionally, the `emailDomain` is interpolated into a `LIKE` clause with `%` wildcards without escaping SOQL wildcards (`%`, `_`).

```typescript
// VULNERABLE — current code
`SELECT Id, OwnerId FROM Lead WHERE Email = '${email.replace(/'/g, "\\'")}' AND ...`
`SELECT Id, OwnerId FROM Account WHERE Website LIKE '%${emailDomain.replace(/'/g, "\\'")}%' LIMIT 1`
```

An attacker who controls record field data could inject arbitrary SOQL and exfiltrate data.

**Fix:** Use jsforce's `.find()` API with object parameters:
```typescript
conn.sobject('Lead').find(
  { Email: email, IsConverted: false, Id: { $ne: currentRecordId } },
  ['Id', 'OwnerId']
).limit(1)
```

---

### C4. Unauthenticated Engine Analytics Endpoints

**File:** `apps/engine/src/routes/analytics.ts` lines 5–15

**Description:** `POST /analytics/conversion-check` and `POST /analytics/reconcile` have **zero authentication**. Anyone who can reach the engine can trigger conversion checks (which make SOQL queries against all connected Salesforce orgs) or reconciliation jobs with arbitrary dates.

**Fix:** Add HMAC or shared-secret authentication to these endpoints. If they're only called by the web app, use a shared secret from environment variables.

---

### C5. Public Endpoints Authenticated Only by Spoofable `X-Sfdc-Org-Id`

**Files:** `/api/setup/onboarding-done/route.ts`, `/api/fields/sync/route.ts`

**Description:** These endpoints are in `PUBLIC_PREFIXES` (no session required) and authenticate solely via the `X-Sfdc-Org-Id` header. Salesforce Org IDs are semi-public (18-char predictable format like `00D000000000001`). An attacker who knows or guesses a valid Org ID can:

- Mark any org's onboarding as complete (`POST /api/setup/onboarding-done`)
- Trigger a field schema sync using stored OAuth tokens (`POST /api/fields/sync`)
- Enumerate connected orgs (`GET /api/setup/status?sfdcOrgId=...`)

**Fix:** Add HMAC signature verification (same pattern as the `/route` endpoint — the webhook secret is already available in Apex).

---

## High Findings

### H1. No Rate Limiting on Login Endpoints

**Files:** `/api/auth/login/route.ts`, `/api/admin/auth/login/route.ts`

**Description:** Neither the user login nor admin login endpoint has rate limiting. Unlimited brute-force attempts against passwords and the admin secret.

**Fix:** Add per-IP rate limiting (5 attempts per 15 minutes) via Redis sliding window or `@upstash/ratelimit`.

---

### H2. No CSRF Protection

**Files:** All POST/PATCH/DELETE API routes

**Description:** No CSRF tokens, no `Origin`/`Referer` header checks anywhere. The `sameSite` cookie attribute is not explicitly set (defaults to `Lax` in most browsers but not guaranteed). Next.js JSON APIs have partial natural protection (forms can't send `Content-Type: application/json`), but this is insufficient defense-in-depth.

**Fix:** Set `sameSite: "lax"` on the session cookie explicitly. Implement `Origin` header validation on mutating requests in `proxy.ts`, or add CSRF tokens.

---

### H3. Web/Engine Ports Exposed Bypassing Caddy (TLS Bypass)

**File:** `lead-routing/docker-compose.yml` lines 52, 69

**Description:** Ports 3000 and 3001 bind to `0.0.0.0`, allowing direct HTTP access to the web app and engine, bypassing Caddy's TLS termination.

**Fix:** Change to `"127.0.0.1:3000:3000"` and `"127.0.0.1:3001:3001"`.

---

### H4. SSRF via Notification Webhook URL

**Files:** `apps/engine/src/webhook.ts` lines 40–44, `/api/settings/notifications/route.ts`

**Description:** Users can set arbitrary `https://` webhook URLs. The engine makes server-side requests to them — could target cloud metadata endpoints (`https://169.254.169.254/`), internal services, or private network resources.

**Fix:** Validate webhook URLs against a blocklist of private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x, 127.x, ::1). Resolve DNS and verify the resolved IP before connecting.

---

### H5. Webhook Secret Readable via Salesforce API

**File:** `Routing_Settings__c` — `visibility: Public`

**Description:** `Webhook_Secret__c` is stored in a Hierarchy Custom Setting with **Public** visibility. Any Salesforce user with API access can SOQL query `SELECT Webhook_Secret__c FROM Routing_Settings__c` and forge HMAC signatures to submit fraudulent routing payloads.

**Fix:** Change the Custom Setting visibility to `Protected` (accessible only via Apex, not SOQL/API), or move to a Protected Custom Metadata Type.

---

### H6. CSV Export Formula Injection

**Files:** `/api/routing-logs/export/route.ts`, `/api/analytics/export/route.ts`

**Description:** User-controlled data (rule names, error messages, assignee names) in CSV exports isn't sanitized for formula-triggering prefixes. Values starting with `=`, `+`, `-`, `@`, `\t` can execute arbitrary formulas when opened in Excel or Google Sheets.

**Fix:** Sanitize cell values:
```typescript
function sanitizeCsvCell(val: string): string {
  if (/^[=+\-@\t\r]/.test(val)) return "'" + val;
  return val;
}
```

---

### H7. Admin Password Persisted in Plaintext on Disk

**File:** `apps/cli/src/templates/env-web.ts` line 51

**Description:** `ADMIN_PASSWORD` is written in plaintext to `.env.web` and persists on the VPS filesystem even after the seed script has hashed it into the database. Anyone with read access to the server can read the admin password.

**Fix:** Remove `ADMIN_PASSWORD` and `ADMIN_EMAIL` from `.env.web` after seeding. Have the entrypoint script clear them after first run, or accept them only as transient CLI arguments.

---

## Medium Findings

### M1. No OAuth `state` Parameter — CSRF on Salesforce OAuth Flow

**Files:** `packages/sfdc/src/client.ts` lines 35–48, `/api/auth/sfdc/login/route.ts`

**Description:** The Salesforce OAuth flow does not include a `state` parameter (the standard CSRF defense for OAuth). An attacker could trick a logged-in victim into completing the attacker's OAuth flow, linking the attacker's Salesforce org to the victim's account. PKCE alone does not prevent this.

**Fix:** Generate a random `state` value, store it in a cookie, and validate it in the callback.

---

### M2. Header Injection Risk on Public Paths

**File:** `apps/web/proxy.ts` lines 84–87

**Description:** The proxy injects `x-org-id`, `x-user-id`, `x-user-name` from the session into request headers for authenticated paths. However, on public paths, incoming headers are **not stripped**. If a public route handler ever calls `getOrgIdFromHeaders()`, it would trust attacker-supplied values.

**Fix:** Delete `x-org-id`, `x-user-id`, `x-user-name` from incoming requests at the top of the proxy function, before any logic runs.

---

### M3. No RBAC Enforcement

**Files:** All API routes

**Description:** The session contains a `role` field (`"ADMIN"` | `"MEMBER"`), but no route handler checks it. A `MEMBER` user has the same API access as an `ADMIN` — they can manage teams, rules, users, and settings.

**Fix:** Add role checks to sensitive endpoints (user management, team management, rule CRUD, settings).

---

### M4. All Registrations Get ADMIN Role

**File:** `/api/auth/register/route.ts` line 64

**Description:** Every new user registration via invite token is hardcoded to `role: "ADMIN"`. The invite record does not specify a role.

**Fix:** Default to `"MEMBER"` and let admins promote, or store the intended role on the invite record.

---

### M5. Docker Containers Run as Root

**Files:** `apps/web/Dockerfile`, `apps/engine/Dockerfile`

**Description:** Neither Dockerfile creates a non-root user. A container escape vulnerability would give the attacker root on the host.

**Fix:** Add `RUN addgroup -S app && adduser -S app -G app` and `USER app` before CMD.

---

### M6. No Security Headers

**Files:** `lead-routing/Caddyfile`, `apps/web/next.config.ts`

**Description:** No `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, or `Referrer-Policy` headers are set. The app is vulnerable to clickjacking and MIME sniffing.

**Fix:** Add to Caddyfile:
```
header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "strict-origin-when-cross-origin"
}
```

---

### M7. No Input Schema Validation on JSON Bodies

**Files:** Most POST/PUT route handlers across `apps/web/app/api/`

**Description:** Route handlers use `await req.json()` and destructure properties without schema validation. No maximum string lengths, no array size limits, no type validation beyond basic truthy checks.

**Fix:** Add Zod schema validation to all POST/PUT handlers. Define maximum lengths and array sizes.

---

### M8. `recordSnapshot` Stores Full PII Indefinitely

**File:** `apps/engine/src/router.ts` lines 264, 384, 557

**Description:** Every routing event stores the complete `fields` object (email, phone, address, etc.) as `recordSnapshot` in `routing_logs`. This data persists indefinitely and is exported via CSV, creating data retention/compliance risk.

**Fix:** Implement a retention policy for `recordSnapshot` (auto-null after N days). Store only routing-relevant fields.

---

### M9. Apex `@AuraEnabled` Methods Lack Permission Checks

**File:** `OnboardingController.cls` lines 27–173

**Description:** All `@AuraEnabled` methods are callable by any Lightning user. No `WITH SECURITY_ENFORCED`, no `isAccessible()` checks, no custom permission gates. Methods like `saveRoutingSettings()` and `sendTestEvent()` should be restricted.

**Fix:** Add a custom permission check:
```apex
if (!FeatureManagement.checkPermission('Lead_Router_Admin')) {
    throw new AuraHandledException('Insufficient permissions');
}
```

---

### M10. `--no-frozen-lockfile` in Dockerfiles

**Files:** `apps/web/Dockerfile` line 15, `apps/engine/Dockerfile` lines 17, 46

**Description:** `pnpm install --no-frozen-lockfile` allows the lockfile to be modified during build. Builds are not reproducible and could pull different (potentially compromised) dependency versions.

**Fix:** Use `--frozen-lockfile` in Docker builds.

---

## Low Findings

### L1. Admin Token Allows Negative Age (Future Timestamps)

**File:** `apps/web/lib/admin-auth.ts` line 27

**Description:** Token validation checks `age > TOKEN_MAX_AGE_MS` but not `age < 0`. A token with a future timestamp has negative age and passes validation indefinitely (requires knowing `ADMIN_SECRET`).

**Fix:** `if (isNaN(age) || age < 0 || age > TOKEN_MAX_AGE_MS) return false;`

---

### L2. Feedback Email HTML Injection via `userName`

**File:** `/api/feedback/route.ts` lines 38–61

**Description:** `actor.userName` is interpolated into HTML email template without escaping. The `message` field is properly escaped but `userName` is not.

**Fix:** Apply HTML entity escaping to `userName`: `.replace(/</g, "&lt;").replace(/>/g, "&gt;")`

---

### L3. Open Redirect Potential via `next` Query Param

**File:** `apps/web/proxy.ts` line 68

**Description:** When redirecting to login, `pathname` is set as the `next` query parameter. If the login page redirects to `next` without validating it's a relative path, this could be an open redirect.

**Fix:** Validate `next` starts with `/` and does not contain `//`.

---

### L4. Redis Has No Authentication

**File:** `apps/cli/src/templates/docker-compose.ts` lines 35–48

**Description:** Redis runs with no `requirepass`. While not port-mapped to the host, any container on the Docker network can access it. If ever accidentally exposed, it's wide open.

**Fix:** Add `requirepass` to Redis config and update `REDIS_URL` with the password.

---

### L5. Sensitive Data in Error Messages

**File:** `apps/engine/src/router.ts` line 311

**Description:** Error messages from SFDC operations stored in `routingLog.errorMessage` via `String(err)` may include stack traces, API URLs, or credentials.

**Fix:** Extract only the message string and omit stack traces.

---

## Positive Findings

| Area | Assessment |
|------|-----------|
| **Password hashing** | PBKDF2 with 310,000 iterations, SHA-256, random salt — adequate |
| **HMAC validation** | Uses `crypto.timingSafeEqual` with proper buffer length handling — prevents timing attacks |
| **PKCE implementation** | SHA-256 + base64url, `crypto.randomBytes(32)` — RFC 7636 compliant |
| **Webhook secret generation** | `crypto.randomBytes(32)` — CSPRNG, 256-bit entropy |
| **Org isolation in routing** | HMAC per-org, rules filtered by orgId, validated at ingress — properly enforced |
| **Session encryption** | iron-session with 256-bit key, httpOnly cookie — adequate |
| **Token refresh persistence** | jsforce `refresh` event → DB write — properly implemented |
| **Cache eviction on auth errors** | `evictOrgConnection()` on `invalid_grant`/`INVALID_SESSION_ID` — properly implemented |

---

## Priority Remediation Order

| Priority | ID | Action | Effort |
|----------|----|--------|--------|
| **IMMEDIATE** | C1 | Rotate all committed secrets, purge git history | 1 hour |
| **IMMEDIATE** | C2 | Bind Postgres to `127.0.0.1` only | 5 min |
| **IMMEDIATE** | H3 | Bind web/engine ports to `127.0.0.1` | 5 min |
| **URGENT** | C3 | Fix SOQL injection — use jsforce `.find()` API | 2 hours |
| **URGENT** | C4 | Add auth to engine analytics endpoints | 1 hour |
| **URGENT** | C5 | Add HMAC to public Apex endpoints | 2 hours |
| **URGENT** | H1 | Add rate limiting to login endpoints | 2 hours |
| **SOON** | H2 | Add CSRF protection (sameSite + Origin check) | 1 hour |
| **SOON** | H4 | SSRF validation on webhook URLs | 2 hours |
| **SOON** | H5 | Change Routing_Settings__c to Protected visibility | 1 hour |
| **SOON** | H6 | CSV formula injection sanitization | 30 min |
| **SOON** | H7 | Remove admin password from .env.web after seed | 1 hour |
| **PLANNED** | M1–M10 | OAuth state, RBAC, Docker hardening, headers, validation | 1–2 days |
| **BACKLOG** | L1–L5 | Token age, HTML escaping, open redirect, Redis auth, error sanitization | 1 day |
