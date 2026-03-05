# Lead Routing — Regression Test Suite

A single authoritative document covering everything that must work before any push or release. Organized in tiers — run faster tiers on every commit, full E2E only before `npm publish`.

---

## Test Tiers

| Tier | Name | Time | When to run |
|------|------|------|-------------|
| **T0** | Pre-push automated (type-check + build) | ~2 min | Every commit — enforced in CI |
| **T1** | Unit tests (`pnpm test`) | ~30 sec | Every commit — enforced in CI |
| **T2** | Smoke tests (local machine, no VPS) | ~10 min | Before every PR merge |
| **T3** | Integration tests (local Docker) | ~20 min | Before CLI version bump |
| **T4** | Full E2E (real VPS + real Salesforce) | ~45 min | Before `npm publish` |

---

## T0 — Pre-Push Automated Checks

Run by CI (`.github/workflows/test.yml`) on every push. All must exit 0.

```bash
# Type-check all packages
pnpm --filter @lead-routing/cli type-check
pnpm --filter @lead-routing/web type-check
pnpm --filter @lead-routing/engine type-check

# Build CLI and verify output
pnpm --filter @lead-routing/cli build
node apps/cli/dist/index.js --version   # CLI binary loads and prints version

# Verify SFDC package is bundled in dist
ls apps/cli/dist/sfdc-package/force-app/main/default/classes/RoutingEngineCallout.cls

# Verify Prisma migrations are bundled in dist
ls apps/cli/dist/prisma/migrations/
```

---

## T1 — Unit Tests

```bash
pnpm test
```

**120 tests across 3 suites, ~600ms total.**

### `apps/engine/src/evaluator.test.ts` — 68 tests

Covers all 17 condition operators and group AND/OR logic in `evaluateRule()`:

| Group | Tests |
|-------|-------|
| Catch-all | zero conditions always matches |
| `is_blank` / `is_not_blank` | null, undefined, "", non-empty string |
| `is_true` / `is_false` | boolean + string variants + null/blank edge cases |
| `equals` / `not_equals` | string match, type coercion (number as string), null vs "" |
| `contains` / `not_contains` | case-insensitive substring |
| `starts_with` | case-insensitive prefix |
| `gt` / `lt` / `gte` / `lte` | numeric coercion from strings, boundary values |
| `before` / `after` | ISO date string comparison |
| `within_last` | relative date window (today passes, beyond window fails) |
| `includes` / `excludes` | semicolon-separated multi-select, all-match, partial, none |
| AND within group | all conditions must pass; one failure = no match |
| OR between groups | any passing group = match |
| Field name normalization | `leadsource` (SFDC lowercase) matches `LeadSource` condition |
| Unknown operator | returns false (safe default) |

### `apps/cli/src/templates/templates.test.ts` — 34 tests

Covers template generators — pure functions where bugs have caused real incidents:

| File | Tests |
|------|-------|
| `renderEnvWeb()` | `ENGINE_URL` = Docker-internal, `PUBLIC_ENGINE_URL` = public HTTPS, they are distinct; `SFDC_REDIRECT_URI` ends with `/api/auth/sfdc/callback`; trailing slash stripped; sandbox vs production login URL |
| `renderDockerCompose()` | Managed DB: postgres present, port `127.0.0.1:5432:5432`; external DB: postgres absent; managed Redis: redis present; external Redis: redis absent; no `condition: service_healthy` when external; web/engine/caddy always present; caddy exposes 80+443 |
| `renderCaddyfile()` | Case A (subdomain engine): two site blocks; Case B (same-domain port): port-based second listener |

### `apps/web/lib/crypto.test.ts` — 18 tests

Covers password hashing and HMAC verification:

| Function | Tests |
|----------|-------|
| `hashPassword()` | Returns `salt:hash` format; salt is 32-char hex; hash is 64-char hex; different result each call (random salt) |
| `verifyPassword()` | Correct password → true; wrong password → false; empty password → false; malformed hash → false; PBKDF2 310000-iteration round-trip |
| `generateWebhookSecret()` | 64-char hex; different each call |
| `generateInviteToken()` | 48-char hex |
| `verifyHmacSignature()` | Correctly signed → true; wrong signature → false; wrong secret → false; tampered payload → false; empty signature → false |

---

## T2 — Smoke Tests (local machine, no VPS, no Docker)

Run before merging any PR. Uses only the built CLI binary.

### 2a. CLI help

```bash
node apps/cli/dist/index.js --help
node apps/cli/dist/index.js init --help
node apps/cli/dist/index.js sfdc --help
node apps/cli/dist/index.js config --help
```

**Pass:** help text printed, exit 0. No crash.

---

### 2b. Dry-run — default (managed DB + Redis)

```bash
rm -rf ./lead-routing
node apps/cli/dist/index.js init --dry-run
# Enter: appUrl=https://leads.test.com, engineUrl=https://engine.test.com
# SFDC client ID/secret: any fake values
# Admin email/password: fake values
```

**Verify `lead-routing/` contains:**

| File | Check |
|------|-------|
| `.env.web` | `ENGINE_URL=http://engine:3001` (Docker-internal) |
| `.env.web` | `PUBLIC_ENGINE_URL=https://engine.test.com` (public HTTPS — different from ENGINE_URL) |
| `.env.web` | `SFDC_REDIRECT_URI=https://leads.test.com/api/auth/sfdc/callback` |
| `.env.web` | `SFDC_LOGIN_URL=https://login.salesforce.com` |
| `docker-compose.yml` | Contains `postgres:` service with port `"127.0.0.1:5432:5432"` |
| `docker-compose.yml` | Contains `redis:` service |
| `Caddyfile` | Two site blocks: `leads.test.com` and `engine.test.com` |
| `lead-routing.json` | Contains `appUrl`, `engineUrl`, `version` (matches `dist/index.js --version`) |
| `lead-routing.json` | No `password` field |
| `lead-routing.json` | `dockerManaged.db = true`, `dockerManaged.redis = true` |

---

### 2c. Dry-run — external DB + external Redis

```bash
rm -rf ./lead-routing
node apps/cli/dist/index.js init --dry-run \
  --external-db "postgresql://u:p@db.host:5432/mydb" \
  --external-redis "redis://redis.host:6379"
```

**Verify `lead-routing/docker-compose.yml`:**
- Does NOT contain `  postgres:` service
- Does NOT contain `  redis:` service
- Does NOT contain `condition: service_healthy`

---

### 2d. Dry-run — sandbox Salesforce

```bash
rm -rf ./lead-routing
node apps/cli/dist/index.js init --dry-run --sandbox
```

**Verify `lead-routing/.env.web`:**
- `SFDC_LOGIN_URL=https://test.salesforce.com`

---

### 2e. Dry-run — same-domain port engine URL

```bash
rm -rf ./lead-routing
# At "Engine URL" prompt enter: https://leads.test.com:3001
node apps/cli/dist/index.js init --dry-run
```

**Verify `lead-routing/Caddyfile`:**
- Contains `leads.test.com:3001 {` (port-based listener, not a new subdomain)
- Contains `reverse_proxy engine:3001` inside that block

---

### 2f. Config show

Place a valid `lead-routing.json` in `./lead-routing/`, then:

```bash
node apps/cli/dist/index.js config show
```

**Pass:** Prints app URL, admin secret, SFDC client ID. Exit 0.

---

## T3 — Integration Tests (local Docker, no VPS, no Salesforce)

**Pre-condition:** Local Docker running, services up: `cd lead-routing && docker compose up -d`

### 3a. Health endpoints

```bash
curl -s http://localhost:3001/health
# Expected: {"status":"ok","ts":"..."}

curl -s http://localhost:3000/api/health
# Expected: {"ok":true}
```

### 3b. Engine HMAC rejection

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3001/route \
  -H "Content-Type: application/json" \
  -H "X-Signature-256: sha256=invalid" \
  -d '{"sfdcOrgId":"00D000","objectType":"LEAD","eventType":"INSERT","recordId":"00Q000","timestamp":"2026-01-01T00:00:00Z","fields":{}}'
# Expected: 401
```

### 3c. Auth — correct credentials

```bash
curl -s -c /tmp/lr-cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"yourpassword"}'
# Expected: {"ok":true}  +  Set-Cookie header
```

### 3d. Auth — wrong password

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"wrong"}'
# Expected: 401
```

### 3e. Protected route without auth

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/rules
# Expected: 401
```

### 3f. Routing rules CRUD

```bash
# Create catch-all dry-run rule
RULE=$(curl -s -b /tmp/lr-cookies.txt -X POST http://localhost:3000/api/rules \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Rule","objectType":"LEAD","triggerEvent":"INSERT","assignmentType":"USER","isDryRun":true,"conditions":[]}')
echo $RULE | grep -o '"id":"[^"]*"'   # Must have an id

RULE_ID=$(echo $RULE | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

# List rules
curl -s -b /tmp/lr-cookies.txt "http://localhost:3000/api/rules?object=LEAD" | grep "Test Rule"
# Expected: rule appears in list

# Test rule (catch-all → always matches)
curl -s -b /tmp/lr-cookies.txt -X POST http://localhost:3000/api/rules/$RULE_ID/test \
  -H "Content-Type: application/json" \
  -d '{"record":{"LeadSource":"Web"}}'
# Expected: {"matched":true,...}

# Delete
curl -s -o /dev/null -w "%{http_code}" -b /tmp/lr-cookies.txt \
  -X DELETE http://localhost:3000/api/rules/$RULE_ID
# Expected: 200
```

### 3g. CLI auth bridge

```bash
curl -s -X POST http://localhost:3000/api/cli-auth/request
# Expected: {"sessionId":"...","authUrl":"https://login.salesforce.com/..."}

curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/cli-auth/poll/nonexistentid
# Expected: 410
```

### 3h. Engine routing — dry-run (no Salesforce needed)

After creating a dry-run catch-all rule via 3f above, and with a licensed user available, generate a valid HMAC signature:

```bash
# Read webhook secret from .env.engine
WEBHOOK_SECRET=$(grep ENGINE_WEBHOOK_SECRET lead-routing/.env.engine | cut -d= -f2)
SFDC_ORG_ID="<your-org-id-from-custom-settings>"
PAYLOAD='{"sfdcOrgId":"'$SFDC_ORG_ID'","objectType":"LEAD","eventType":"INSERT","recordId":"00Q999TEST001","timestamp":"2026-01-01T00:00:00Z","fields":{"FirstName":"Regression","LastName":"Test"}}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print "sha256="$2}')

curl -s -X POST http://localhost:3001/route \
  -H "Content-Type: application/json" \
  -H "X-Signature-256: $SIG" \
  -H "X-Sfdc-Org-Id: $SFDC_ORG_ID" \
  -d "$PAYLOAD"
# Expected: {"status":"dry_run","latencyMs":...}
# Verify: routing log in dashboard → status=SUCCESS, isDryRun=true
```

### 3i. CLI commands (pointing at local Docker stack)

```bash
lead-routing doctor       # All checks ✔, exit 0
lead-routing status       # All containers: Up
lead-routing config show  # Prints admin secret, app URL, SFDC client ID
```

---

## T4 — Full E2E Regression (real VPS + real Salesforce)

Run before every `npm publish`. Supersedes `E2E-TEST-PLAYBOOK.md`.

### Phase 1: Teardown + Fresh Install

```bash
# On VPS (SSH in):
cd ~/lead-routing && docker compose down -v
cd ~ && rm -rf ~/lead-routing

# Locally:
rm -rf ./lead-routing
rm -rf ~/.npm/_npx    # clear npx cache so new version is fetched

# Run init with explicit version
npx @lead-routing/cli@{version} init
```

Supply all prompts: VPS IP, SSH password, app URL (`https://leads.{domain}`), engine URL (`https://engine.{domain}`), SFDC client ID/secret, admin email/password.

**Pass criteria:** All 9 steps show green (Local prereqs ✓ → SSH connect ✓ → Config ✓ → Generate files ✓ → Remote setup ✓ → Upload ✓ → Start services ✓ → Migrations ✓ → Health check ✓), followed by Salesforce package deploy completion.

---

### Phase 2: Verify Generated Files (locally, before VPS)

| File | Check |
|------|-------|
| `lead-routing/.env.web` | Has `ENGINE_URL=http://engine:3001` AND `PUBLIC_ENGINE_URL=https://engine.{domain}` (both present, different values) |
| `lead-routing/.env.web` | `SFDC_REDIRECT_URI` ends with `/api/auth/sfdc/callback` |
| `lead-routing/lead-routing.json` | `version` matches the CLI version used (`@lead-routing/cli@{version}`) |
| `lead-routing/lead-routing.json` | No `password` field |

---

### Phase 3: Service Health (public HTTPS)

```bash
curl -s https://leads.{domain}/api/health    # {"ok":true}
curl -s https://engine.{domain}/health       # {"status":"ok","ts":"..."}
```

---

### Phase 4: First Login

- Navigate to `https://leads.{domain}`
- Login with admin credentials from init
- **Pass:** Dashboard loads, onboarding checklist Step 1 is incomplete (Salesforce not connected yet)

---

### Phase 5: Salesforce OAuth + Custom Settings Verification

1. Settings → "Connect Salesforce" → complete OAuth flow
2. After redirect, navigate to **Salesforce → Setup → Custom Settings → Routing Settings → Manage**
3. Check **Default Organization Level Value**:

| Field | Expected |
|-------|----------|
| `Engine_Endpoint__c` | `https://engine.{domain}` — must NOT be `http://engine:3001` |
| `App_URL__c` | `https://leads.{domain}` |
| `Webhook_Secret__c` | 64-char hex string |

> **This is the most critical check.** A previous regression (v0.1.12) had `Engine_Endpoint__c = http://engine:3001` which silently broke all lead routing.

---

### Phase 6: Onboarding Wizard (Salesforce)

1. Open App Launcher → "Lead Router Setup"
2. Step 1 — Connection Check: green ✓
3. Step 2 — Settings: enable "Lead Insert" → Save
4. Step 3 — Field Sync: syncs Lead fields (should show count > 0)
5. Step 4 — Complete: marks onboarding done
6. Back in web app: all 4 dashboard checklist items show green ✓

---

### Phase 7: License User + Create Rule

1. Go to License Users → Sync Users → license at least 1 user
2. Go to Routing Rules → Create Rule:
   - Object: Lead
   - Event: Insert
   - Assignment: User → select the licensed user
   - Conditions: none (catch-all)
   - Dry Run: OFF
   - Status: ACTIVE

---

### Phase 8: End-to-End Lead Routing ← Core Verification

1. In Salesforce, create a new Lead (any name/company)
2. Within 5 seconds:
   - Lead `OwnerId` changes to the licensed user's SFDC user ID
3. In web app → History page:
   - 1 new log entry
   - Status: **SUCCESS**
   - Rule name: matches the created rule
   - Assignee: matches the licensed user name

---

### Phase 9: CLI Commands Smoke Test

```bash
lead-routing doctor          # All checks: ✔, exit 0
lead-routing status          # All containers: Up (or similar)
lead-routing config show     # Prints admin secret, app URL, SFDC client ID
lead-routing logs engine     # Streams logs (press Ctrl+C after ~2 lines, no crash)
```

---

### Phase 10: Deploy Command

```bash
lead-routing deploy
```

**Pass:** No errors, containers restarted, migrations run (no re-seed).

Verify health endpoints still return 200 after deploy:
```bash
curl -s https://leads.{domain}/api/health    # {"ok":true}
curl -s https://engine.{domain}/health       # {"status":"ok"}
```

---

### Phase 11: SFDC Redeploy

```bash
lead-routing sfdc deploy
```

**Pass:** Deploys (or re-deploys) package cleanly.

Re-check Salesforce Custom Settings → `Engine_Endpoint__c` still = `https://engine.{domain}` (not Docker-internal URL).

---

## Condition Regression Matrix

Run after any change to `apps/engine/src/evaluator.ts` or routing rule creation/evaluation logic:

| # | Rule Setup | Input Lead Fields | Expected Result |
|---|-----------|-------------------|-----------------|
| 1 | No conditions (catch-all) | Any | `routed` |
| 2 | `LeadSource equals "Web"` | `LeadSource="Web"` | `routed` |
| 3 | `LeadSource equals "Web"` | `LeadSource="API"` | `unmatched` |
| 4 | `Company contains "tech"` | `Company="TechCorp"` | `routed` (case-insensitive) |
| 5 | `Phone is_blank` | `Phone=null` | `routed` |
| 6 | `Phone is_blank` | `Phone="555-1234"` | `unmatched` |
| 7 | `AnnualRevenue gt 50000` | `AnnualRevenue="100000"` | `routed` (string→number coercion) |
| 8 | `AnnualRevenue gt 50000` | `AnnualRevenue="10000"` | `unmatched` |
| 9 | `Industry includes "Tech;Finance"` | `Industry="Technology;Finance"` | `routed` |
| 10 | `Industry excludes "Tech"` | `Industry="Technology"` | `unmatched` |
| 11 | Group1: `LeadSource="Web"` AND `Rating="Hot"` | `LeadSource="Web", Rating="Cold"` | `unmatched` (AND fails) |
| 12 | Group1: `LeadSource="Web"`, Group2: `LeadSource="API"` | `LeadSource="API"` | `routed` (OR group 2 passes) |
| 13 | Catch-all, `isDryRun=true` | Any | `dry_run` (log=SUCCESS, SFDC owner unchanged) |
| 14 | Rule status=INACTIVE, catch-all | Any | `unmatched` (inactive rules not evaluated) |
| 15 | Round-robin team, 3 members | 3 consecutive leads | Each assigned to a different member in rotation order |
| 16 | Any rule | Same `recordId+eventType+timestamp` sent twice | Second returns `duplicate`, only 1 log entry |

---

## Change-Specific Verification

After making any of these changes, run the corresponding checks before pushing:

| Changed file | What to verify |
|-------------|----------------|
| `apps/cli/src/steps/run-migrations.ts` (seed SQL) | T4 Phase 1: org seeded with `plan=PAID`, `seatsPurchased=9999`, `isActive=true`; no `routingQuota` column referenced |
| `apps/cli/src/templates/env-web.ts` | T2b: `.env.web` has both `ENGINE_URL=http://engine:3001` AND `PUBLIC_ENGINE_URL=<public>`; `SFDC_REDIRECT_URI` ends with `/api/auth/sfdc/callback`; run `pnpm test` (templates.test.ts) |
| `apps/cli/src/templates/docker-compose.ts` | T2b/T2c: postgres port is `127.0.0.1:5432:5432`; external services correctly omitted; run `pnpm test` |
| `apps/cli/src/templates/caddy.ts` | T2b/T2e: both URL cases generate correct blocks; run `pnpm test` |
| `apps/cli/src/steps/sfdc-deploy-inline.ts` | T4 Phase 5: `Engine_Endpoint__c` = public engine URL from `lead-routing.json` (not from `.env.web`) |
| `apps/cli/src/steps/check-remote-prerequisites.ts` | T4 Phase 1: Docker auto-installs on a fresh Ubuntu VPS; port conflict stops known services |
| `apps/engine/src/evaluator.ts` | Run `pnpm test` (evaluator.test.ts — 68 cases); run T3h or T4 Phase 8 for live routing |
| `packages/sfdc/src/settings.ts` (`pushSettings`) | T4 Phase 5: `Engine_Endpoint__c` = public HTTPS URL (not `http://engine:3001`) |
| Any CLI version bump | T2a: `node apps/cli/dist/index.js --version` prints new version; T2b: `lead-routing.json` `version` matches |
| Any new Prisma migration | T0: `ls apps/cli/dist/prisma/migrations/` shows new file; T4 Phase 1: `prisma migrate deploy` applies cleanly |
| `apps/web/lib/crypto.ts` | Run `pnpm test` (crypto.test.ts — 18 cases) |

---

## CI/CD

`.github/workflows/test.yml` runs T0 + T1 automatically on every push and pull request.

To run T1 locally at any time:
```bash
pnpm test
```

To run full T0 + T1 locally:
```bash
pnpm --filter @lead-routing/cli type-check && \
pnpm --filter @lead-routing/web type-check && \
pnpm --filter @lead-routing/engine type-check && \
pnpm --filter @lead-routing/cli build && \
pnpm test
```
