# License Anti-Sharing Plan

## Context
License keys can be shared between servers because fingerprinting uses only `os.hostname()` (trivially spoofable), heartbeats run weekly (7-day enforcement gap), and there's no concurrent instance detection or rate limiting. We need practical anti-sharing that deters casual piracy without frustrating honest customers.

**Key principle**: Never suspend a paying customer's license. Only reject unauthorized servers.

## Approach: 4-Layer Defense

### Layer 1: Composite Fingerprint
Replace bare `hostname()` with a SHA-256 hash of multiple signals:
- `/etc/machine-id` (mounted from host via docker-compose volume)
- `os.cpus().length`
- `os.totalmem()` (rounded to nearest GB)
- `process.env.HOSTNAME` (Docker container short ID)

New files: `apps/engine/src/fingerprint.ts` + `apps/web/lib/fingerprint.ts`

Docker-compose change: Add `- /etc/machine-id:/etc/machine-id:ro` volume to web + engine.

Migration: Add `fingerprintVersion` column. When engine sends v2 fingerprint, license server auto-rebinds (one-time silent migration for existing customers).

### Layer 2: Frequent Heartbeats + Stale Guard
- Change heartbeat from weekly to **every 6 hours** (`0 */6 * * *`)
- Track consecutive failures in Redis
- After 3 consecutive failures → downgrade to free tier
- Stale guard: Engine `/route` endpoint rejects if last successful heartbeat > 48 hours ago
- Reduce subscription grace period from 30 to 7 days

### Layer 3: Mismatch Logging (No Auto-Suspend)
- Log every validation/heartbeat attempt to `heartbeat_log` table
- On fingerprint mismatch: log it, reject the request, but **never suspend** the paying customer
- Useful for admin visibility into sharing attempts
- Original bound server always keeps working

### Layer 4: Rate Limiting + Self-Service Reset

**Rate limiting** (D1 sliding window):
- `/v1/licenses/validate`: 10 per key per hour
- `/v1/licenses/heartbeat`: 30 per key per day

**Fingerprint reset** for legitimate server migrations:
- `POST /v1/licenses/reset-fingerprint` — authenticated, customer-only
- Max 2 resets per calendar year per license
- Clears fingerprint binding so new server can bind
- Old server's next heartbeat fails → stops routing after 48 hours

## Server Migration Flow (Customer Perspective)
1. Customer spins up new VPS, deploys with their license key
2. New server is rejected: "Key already activated on another server"
3. Customer goes to openedgeai.tech dashboard → clicks "Reset Server Binding"
4. Customer restarts new server → new fingerprint binds → working
5. Old server dies naturally (heartbeat fails within 6 hours, routing stops at 48 hours)

**Note**: Migrating loses all data (rules, logs, teams, analytics). A future `lead-routing migrate` CLI command could automate pg_dump/restore + fingerprint reset + SFDC re-deploy.

## Schema Changes

```sql
ALTER TABLE licenses ADD COLUMN fingerprintVersion INTEGER NOT NULL DEFAULT 1;
ALTER TABLE licenses ADD COLUMN fingerprintResetCount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE licenses ADD COLUMN lastFingerprintReset TEXT;

CREATE TABLE IF NOT EXISTS heartbeat_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  licenseKey TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_heartbeat_log_key ON heartbeat_log(licenseKey);

CREATE TABLE IF NOT EXISTS rate_limits (
  id TEXT PRIMARY KEY,
  windowStart TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
```

## Files Changed

| File | Change |
|------|--------|
| `apps/engine/src/fingerprint.ts` | NEW — composite fingerprint generator |
| `apps/web/lib/fingerprint.ts` | NEW — same fingerprint logic for web |
| `apps/engine/src/license-heartbeat.ts` | 6-hour cron, new fingerprint, failure tracking |
| `apps/engine/src/server.ts` | new fingerprint, stale-heartbeat guard on /route |
| `apps/web/app/api/license/activate/route.ts` | use composite fingerprint |
| `apps/web/docker-entrypoint.sh` | use composite fingerprint |
| `apps/cli/src/templates/docker-compose.ts` | add machine-id volume mount |
| `license-server/schema.sql` | new tables + columns |
| `license-server/src/lib/db.ts` | new helpers for logging, reset, rate limiting |
| `license-server/src/lib/rate-limit.ts` | NEW — sliding window rate limiter |
| `license-server/src/routes/validate.ts` | logging, rate limiting, fingerprintVersion migration |
| `license-server/src/routes/heartbeat.ts` | logging, rate limiting, fingerprintVersion migration |
| `license-server/src/routes/reset-fingerprint.ts` | NEW — self-service fingerprint reset |
| `license-server/src/routes/webhook.ts` | reduce grace period to 7 days |

## Implementation Order
1. Schema migrations (D1 execute)
2. Composite fingerprint (engine + web + license server migration)
3. Heartbeat frequency + stale guard (engine)
4. Mismatch logging (license server)
5. Rate limiting (license server)
6. Reset flow (license server + dashboard UI)
7. Deploy all
