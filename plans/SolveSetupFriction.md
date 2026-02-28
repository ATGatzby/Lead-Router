# CLI Customer Onboarding — Setup Friction Audit & Fix Plan

## Context
A customer installs Lead Routing by running `npx @lead-routing/cli init` on their own server. The goal is for the CLI to capture every step they need to complete. This document identifies where the current flow has gaps — steps the customer must figure out themselves, steps that fail silently, and steps the CLI doesn't mention at all.

---

## Current Customer Journey (What's Automated vs Manual)

### Automated ✅
- Docker/Compose/Node prerequisite check
- Interactive config collection (11 prompts)
- Generate `docker-compose.yml`, `.env.web`, `.env.engine`, `lead-routing.json`
- Pull images + `docker compose up -d`
- Run Prisma migrations from host
- Seed admin user (PBKDF2 hash, raw SQL)
- Poll health endpoints for web + engine

### Manual (customer must figure out themselves) ⚠️
- Create Salesforce Connected App (before running init)
- Register the exact callback URL in the Connected App
- Get a public-facing domain + server
- Set up SSL/TLS (Salesforce requires HTTPS)
- Install Salesforce CLI (`sf`) — only discovered when running `sfdc deploy`
- Expose engine on a public URL (Salesforce can't call localhost)
- Complete Salesforce OAuth in the web app browser after init
- Complete the 4-step Salesforce onboarding wizard in the App Launcher

---

## Friction Points & Proposed Fixes

### 1. No "What to Do Next" Summary After Init
**Severity**: Critical
**Gap**: When `init` completes, the CLI prints basic success info but no actionable next steps. The customer doesn't know they need to run `sfdc deploy`, connect Salesforce OAuth, complete the onboarding wizard, or ensure the engine is publicly accessible.

**Fix**: Print a numbered checklist at the end of `init`:
```
╭─ Next Steps ──────────────────────────────────────────────────╮
│                                                               │
│  1. Point your domain to this server and set up SSL/TLS      │
│  2. Update SFDC Connected App callback URL:                   │
│     https://your-domain.com/api/auth/callback                 │
│  3. Run: lead-routing sfdc deploy                             │
│  4. Open https://your-domain.com and log in as admin          │
│  5. Salesforce App Launcher → Lead Router Setup → connect org │
│                                                               │
╰───────────────────────────────────────────────────────────────╯
```

---

### 2. Engine URL Is Hardcoded to Localhost — Never Warned
**Severity**: Critical
**Gap**: `lead-routing.json` and `.env.web` store `engineUrl: "http://localhost:3001"`. The CLI never tells the customer that Salesforce needs to reach the engine from the internet. All Apex routing callouts silently fail when Salesforce tries to call localhost.

**Fix**: During config collection, ask for a public engine URL separately from the app URL. At minimum, warn prominently:
```
⚠  The engine must be accessible from the internet for Salesforce
   to route leads. localhost:3001 will NOT work in production.
   Set up a reverse proxy or public URL for port 3001.
```

---

### 3. No SSL/TLS Setup or Mention
**Severity**: Critical
**Gap**: CLI deploys services on HTTP (ports 3000/3001). Salesforce Named Credentials and Apex callouts require HTTPS. There is no mention of this requirement in the CLI, and no reverse proxy is set up.

**Options**:
- **Quick fix (low effort)**: Warn prominently before init starts that a public HTTPS URL is required
- **Full fix (high effort)**: Bundle Caddy or Traefik in `docker-compose.yml` with auto-HTTPS via Let's Encrypt

---

### 4. Salesforce Connected App Must Exist Before Init
**Severity**: High
**Gap**: The init wizard asks for Consumer Key/Secret but doesn't verify they're valid, and gives no warning that the Connected App must already exist with the exact callback URL registered. If wrong, customer gets a cryptic `redirect_uri_mismatch` error during OAuth.

**Fix**: Before the SFDC credential prompts, show a guided checklist with the exact callback URL pre-computed:
```
Before continuing, create a Salesforce Connected App:

  1. Salesforce Setup → App Manager → New Connected App
  2. Enable OAuth Settings
  3. Callback URL: https://your-domain.com/api/auth/callback  ← exact
  4. Scopes: api, refresh_token, offline_access, openid
  5. Require Secret for Web Server Flow: YES
  6. Save and wait ~2 minutes, then copy Consumer Key + Secret

Press Enter when your Connected App is ready...
```

---

### 5. Port Availability Not Checked
**Severity**: High
**Gap**: CLI doesn't check if ports 3000, 3001, 5432, or 6379 are already in use before `docker compose up`. Docker fails silently and health checks just time out at Step 6 with no indication of the root cause.

**Fix**: Pre-flight port check before Step 4 using `lsof` or attempting to bind. Report which specific port is blocked.

---

### 6. Salesforce CLI (`sf`) Is a Hidden Prerequisite
**Severity**: High
**Gap**: `sf` CLI is required for `lead-routing sfdc deploy` but is NOT checked during `init`. Customer discovers this only after the main setup is complete — "Setup complete!" → runs `sfdc deploy` → error: "Salesforce CLI not found."

**Fix**: Add `sf --version` to the Step 1 prerequisite checks. If missing, show install instructions and offer to open the browser to the Salesforce CLI download page.

---

### 7. Salesforce Onboarding Wizard Is Completely Undocumented
**Severity**: High
**Gap**: After `sfdc deploy`, the customer must go to the Salesforce App Launcher → "Lead Router Setup" and complete a 4-step onboarding wizard. This is never mentioned anywhere in CLI output. Customer assumes "deploy done = fully set up."

**Fix**: Add to the post-`sfdc deploy` output:
```
╭─ Final Step in Salesforce ─────────────────────────────────────╮
│                                                                │
│  1. Open your Salesforce org                                   │
│  2. App Launcher → search "Lead Router Setup"                  │
│  3. Click "Connect to Lead Router" and authorize OAuth         │
│  4. Complete the 4-step setup wizard:                          │
│     Step 1 — Verify connection to Lead Routing                 │
│     Step 2 — Configure routing preferences                     │
│     Step 3 — Sync Lead field schema                            │
│     Step 4 — Confirm onboarding complete                       │
│                                                                │
╰────────────────────────────────────────────────────────────────╯
```

---

### 8. No Firewall Guidance
**Severity**: Medium
**Gap**: For Salesforce to reach the engine, port 443 (or 3001) must be open to the internet. For customers to access the web app, port 80/443 (or 3000) must be open. CLI never mentions firewall rules.

**Fix**: Note in the post-init checklist:
```
Ensure your firewall allows inbound traffic:
  - Port 80/443  → web app (customer access)
  - Port 3001    → routing engine (Salesforce callouts)
```

---

### 9. `doctor` Doesn't Check Salesforce Connectivity
**Severity**: Medium
**Gap**: `lead-routing doctor` checks Docker containers and HTTP health endpoints but doesn't verify that Salesforce OAuth is connected or that the engine is reachable from the internet.

**Fix**: Add to `doctor`:
- Check if `engineUrl` in `lead-routing.json` is localhost (warn if so)
- Call `/api/health` and check for SFDC connection status in the response
- Optionally ping the engine from an external service to verify internet reachability

---

### 10. Re-init on Existing Postgres Volume Silently Ignores New Password
**Severity**: Medium
**Gap**: If the customer re-runs `init` (or changes the generated password), the `POSTGRES_PASSWORD` env var is ignored because the volume already exists from the first `initdb`. Containers then fail to authenticate with a confusing error.

**Fix**: During Step 4, detect existing named volumes and warn:
```
⚠  Existing postgres_data volume found.
   The database password cannot be changed via re-init.
   To reset: docker volume rm lead-routing_postgres_data
   (WARNING: this deletes all data)
```

---

### 11. Admin Secret Easy to Miss in Terminal Output
**Severity**: Low
**Gap**: The generated `ADMIN_SECRET` is shown once at the end of init. If the customer scrolls past it or their terminal truncates output, they must remember to run `lead-routing config show` to retrieve it — which isn't obvious.

**Fix**: Box/highlight the admin secret clearly and mention the recovery command:
```
┌─────────────────────────────────────────────────────┐
│  ADMIN SECRET (save this somewhere safe)            │
│                                                     │
│  a3f9bc12e7d04815                                   │
│                                                     │
│  To retrieve later: lead-routing config show        │
└─────────────────────────────────────────────────────┘
```

---

### 12. No Backup Tooling
**Severity**: Low (v2)
**Gap**: Customer's data lives entirely in a Docker volume on their server. No backup mechanism exists. If the server fails, all routing rules, logs, and configuration are lost.

**Fix (v2)**: `lead-routing backup` command that `pg_dump`s the database to a local file or S3-compatible bucket.

---

## Priority & Effort Matrix

| # | Gap | Severity | Effort | Recommended Phase |
|---|-----|----------|--------|-------------------|
| 1 | No "What to do next" summary after init | Critical | Low | Now |
| 2 | Engine URL is localhost — never warned | Critical | Low | Now |
| 4 | SFDC Connected App guidance before prompts | High | Low | Now |
| 6 | `sf` CLI missing from prerequisites | High | Low | Now |
| 7 | Salesforce wizard steps undocumented | High | Low | Now |
| 11 | Admin secret visibility | Low | Low | Now |
| 5 | Port availability pre-flight check | High | Medium | Soon |
| 8 | Firewall guidance in output | Medium | Low | Soon |
| 9 | `doctor` SFDC + internet reachability check | Medium | Medium | Soon |
| 10 | Re-init volume edge case warning | Medium | Medium | Soon |
| 3 | SSL/TLS — warning only | Critical | Low | Soon |
| 3 | SSL/TLS — Caddy/Traefik in docker-compose | Critical | High | v2 |
| 12 | Backup tooling | Low | High | v2 |
