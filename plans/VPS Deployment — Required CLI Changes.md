# VPS Deployment — Required CLI Changes

## Context
The CLI was only tested locally with ngrok. On a real VPS, several hardcoded assumptions break: `ENGINE_URL` is always `localhost:3001`, there's no SSL/TLS, postgres is publicly exposed, and the CLI never asks for a public engine URL. This plan covers every change needed for `lead-routing init` to produce a working VPS deployment end-to-end.

---

## Critical Bugs That Break VPS (Must Fix)

### Bug 1: `ENGINE_URL` Is Wrong Inside Docker
**File**: `apps/cli/src/templates/env-web.ts`
**Problem**: `.env.web` is written with `ENGINE_URL=http://localhost:3001`. Inside the `web` container, `localhost` is the container itself — not the engine container. Docker containers talk to each other via service names.
**Fix**: Change to `ENGINE_URL=http://engine:3001` (Docker Compose service name).

### Bug 2: Public Engine URL Is Never Collected
**File**: `apps/cli/src/init/collect-config.ts` + `apps/cli/src/init/generate-files.ts`
**Problem**: `lead-routing.json` stores `engineUrl: "http://localhost:3001"` (hardcoded). This URL is patched into the Salesforce Named Credential and Remote Site Setting. Salesforce can't call `localhost` from the cloud — routing breaks silently.
**Fix**: Add a prompt for the public engine URL (e.g., `https://engine.acme.com` or `https://acme.com:3001`). Store it in `lead-routing.json` and use it for SFDC patching. Keep `ENGINE_URL=http://engine:3001` in `.env.web` for Docker-internal communication.

### Bug 3: Postgres Port Exposed Publicly
**File**: `apps/cli/src/templates/docker-compose.ts`
**Problem**: `postgres` service has `ports: ["5432:5432"]` — this binds to `0.0.0.0:5432` on the VPS, exposing the database to the internet.
**Fix**: Change to `127.0.0.1:5432:5432` so it binds only to localhost (CLI migrations still work, internet cannot reach it).

---

## SSL/TLS — Bundle Caddy (Decided ✅)
**No SSL = Salesforce won't accept the Named Credential or Remote Site Settings.**
Caddy is bundled in the generated `docker-compose.yml`. Customers point their domain at the VPS and Caddy auto-provisions Let's Encrypt certs with zero config.

**Caddy service** (added to `docker-compose.ts` template):
```yaml
caddy:
  image: caddy:2-alpine
  restart: unless-stopped
  ports:
    - "80:80"
    - "443:443"
    - "443:443/udp"   # HTTP/3
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile:ro
    - caddy_data:/data
    - caddy_config:/config
  depends_on: [web, engine]
```

**Generated `Caddyfile`** — logic depends on engine URL format the customer provides:

**Case A — Engine is a subdomain** (`https://engine.acme.com`):
```
acme.com {
  reverse_proxy web:3000
}

engine.acme.com {
  reverse_proxy engine:3001
}
```

**Case B — Engine is same domain with custom port** (`https://acme.com:3001`):
```
acme.com {
  reverse_proxy web:3000
}

acme.com:3001 {
  reverse_proxy engine:3001
  tls {
    # Caddy reuses the cert from acme.com
  }
}
```

Detection logic in `generate-files.ts`: parse engineUrl hostname — if it matches appUrl hostname, it's Case B (port); otherwise Case A (subdomain).

With Caddy:
- Web ports (3000) and engine ports (3001) are NOT directly exposed to the internet — Caddy proxies them
- Postgres stays bound to `127.0.0.1:5432` only (host CLI access for migrations)
- Certs auto-issued + auto-renewed

---

## All Files to Change

| File | Change |
|------|--------|
| `apps/cli/src/init/collect-config.ts` | Add `engineUrl` prompt after `appUrl`; show example formats |
| `apps/cli/src/init/generate-files.ts` | Use collected `engineUrl` (not hardcoded localhost); write Caddyfile |
| `apps/cli/src/templates/env-web.ts` | Change `ENGINE_URL` to `http://engine:3001` |
| `apps/cli/src/templates/docker-compose.ts` | Add Caddy service + volumes; change postgres to `127.0.0.1:5432:5432`; remove direct web/engine port exposure |
| `apps/cli/src/templates/caddy.ts` | **New file** — Caddyfile template |
| `apps/cli/src/init/check-prerequisites.ts` | Add port check (80, 443); add `sf --version` check |
| `apps/cli/src/init/verify-health.ts` | Use public engine URL for health checks (not localhost) |
| `apps/cli/src/commands/init.ts` | Add "Next Steps" checklist printed after init completes |

---

## Config Collection Changes (Step 2)

New prompt flow after `appUrl`:

```
? Engine URL — public URL where the routing engine will be accessible
  (Salesforce will call this to route leads)
  Placeholder: https://engine.acme.com  OR  https://acme.com:3001
```

**Guidance to show in prompt**:
```
Engine URL examples:
  Subdomain: https://engine.acme.com  (recommended — requires DNS A record)
  Port:      https://acme.com:3001    (single domain — requires firewall open on 3001)
```
Validation: must be a valid HTTPS URL. Both formats supported — `generate-files.ts` detects which and generates the correct Caddyfile block.

The `engineUrl` and `appUrl` are then:
- Written to `lead-routing.json`
- Used to generate the `Caddyfile` (extracted domain/hostname)
- Used to patch Salesforce Named Credential + Remote Site Settings
- NOT used in `.env.web`/`.env.engine` (those use Docker service names internally)

---

## Post-Init Next Steps Output

Add to end of `commands/init.ts`:

```
╭─ Setup Complete ───────────────────────────────────────────────╮
│                                                                │
│  Admin Panel:  https://acme.com/admin                         │
│  Admin Secret: a3f9bc12e7d04815  (run `lead-routing config    │
│                show` to retrieve later)                        │
│                                                                │
│  Next Steps:                                                   │
│  1. Ensure DNS for acme.com and engine.acme.com point to       │
│     this server (Caddy will auto-provision SSL certificates)   │
│  2. Update your SFDC Connected App callback URL to:            │
│     https://acme.com/api/auth/callback                         │
│  3. Open firewall ports: 80, 443 (+ 3001 if using port URL)   │
│  4. Run: lead-routing sfdc deploy                              │
│  5. Open Salesforce → App Launcher → Lead Router Setup         │
│     → Connect to Lead Router → complete 4-step wizard          │
│                                                                │
╰────────────────────────────────────────────────────────────────╯
```

---

## Prerequisite Check Additions (Step 1)

Add to `check-prerequisites.ts`:
- `sf --version` — warn + show install URL if missing (non-blocking, but note it's needed for `sfdc deploy`)
- Port availability check for 80, 443 — block if in use (Caddy needs these)

---

## Verification (How to Test)

1. Spin up a fresh VPS (Ubuntu 24.04 LTS)
2. Install Docker + Docker Compose v2 + Node 20
3. Point a domain (e.g., `leads.test.com`) and subdomain (`engine.leads.test.com`) A records at the VPS IP
4. Clone repo, run `node dist/index.js init` from `apps/cli/`
5. Provide `https://leads.test.com` as appUrl, `https://engine.leads.test.com` as engineUrl
6. Verify: `docker compose ps` shows all 5 services (caddy, web, engine, postgres, redis) healthy
7. Verify: `https://leads.test.com` loads (valid SSL cert)
8. Verify: `https://engine.leads.test.com/health` returns `{ status: "ok" }` (valid SSL cert)
9. Run `lead-routing sfdc deploy` — verify Named Credential endpoint is `https://engine.leads.test.com`
10. Complete Salesforce OAuth + onboarding wizard
11. Create a Lead in Salesforce — verify routing log appears in web app
