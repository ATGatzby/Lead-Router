# End-to-End Test Playbook — Customer Experience Simulation

> **Goal:** Verify the complete customer journey from zero to working lead routing.
> **VPS:** `openedgeai.tech` — web app at `leads.openedgeai.tech`, engine at `engine.openedgeai.tech`

---

## Prerequisites — Prepare Before You Start

### On the VPS (one-time infra setup)
These should already be done. Verify with the checklist below.

| Check | Command | Expected |
|-------|---------|----------|
| Docker 24+ | `docker --version` | `Docker version 24.x` or higher |
| Docker Compose v2 | `docker compose version` | `Docker Compose version v2.x` |
| Node 20+ | `node --version` | `v20.x` or higher |
| Ports 80 + 443 open | `curl -I http://leads.openedgeai.tech` | Any response (not timeout) |
| DNS A record — web | `dig leads.openedgeai.tech +short` | VPS public IP |
| DNS A record — engine | `dig engine.openedgeai.tech +short` | VPS public IP |

### On your local machine (the "customer" machine)
| Check | Command | Expected |
|-------|---------|----------|
| Node 20+ | `node --version` | `v20.x` or higher |
| npx available | `npx --version` | any version |
| Salesforce CLI | `sf --version` | `@salesforce/cli/...` |

### Salesforce Connected App — Create Once
1. Log into your Salesforce Developer org (or sandbox)
2. **Setup → App Manager → New Connected App**
3. Fill in:
   - **Connected App Name:** `Lead Routing`
   - **Contact Email:** your email
   - Check **Enable OAuth Settings**
   - **Callback URL:** `https://leads.openedgeai.tech/api/auth/callback`
   - **Selected Scopes:** `api` · `refresh_token, offline_access` · `openid`
   - Check **Require Secret for Web Server Flow**
4. **Save** — wait ~2 minutes
5. Click **Manage Consumer Details**
6. Copy the **Consumer Key** (= Client ID) and **Consumer Secret** — you'll need these during `init`

---

## Phase 1 — Tear Down Any Existing Install (Clean Slate)

> Skip this if you are testing on a truly fresh VPS.

SSH into the VPS:

```bash
ssh root@<vps-ip>
```

Tear down existing containers and volumes:

```bash
cd ~/lead-routing   # or wherever the install dir is
docker compose down -v   # -v removes volumes (wipes DB + Redis data)
cd ~
rm -rf lead-routing      # remove generated config files
```

Verify nothing is running:

```bash
docker ps   # should show empty or unrelated containers
```

---

## Phase 2 — Run the CLI (Customer Experience)

This is the exact command a customer runs. Do this on your **local machine** (not the VPS) — or on the VPS directly, both work.

> For a realistic simulation, run on your **local machine** or in a fresh terminal on the VPS.

### 2a. Run init

```bash
npx @lead-routing/cli@latest init
```

> If testing a locally built version (not published), run from the monorepo:
> ```bash
> cd apps/cli && pnpm build && node dist/index.js init
> ```

### 2b. Walk Through the Prompts

The wizard has 6 steps. Fill in these exact values for the VPS test:

| Prompt | Value |
|--------|-------|
| App URL | `https://leads.openedgeai.tech` |
| Engine URL | `https://engine.openedgeai.tech` |
| Salesforce environment | `Production / Developer org` |
| Consumer Key (Client ID) | _(paste from Connected App)_ |
| Consumer Secret | _(paste from Connected App)_ |
| Manage PostgreSQL with Docker? | `Yes` |
| Manage Redis with Docker? | `Yes` |
| Admin email | `admin@openedgeai.tech` (or any email you control) |
| Admin password | _(choose, 8+ chars — write it down)_ |
| Configure Resend? | `No` (skip for test) |

### 2c. Watch the Steps

The CLI will automatically:
- **Step 1** — Check Docker, ports, Node version, Salesforce CLI
- **Step 2** — Collect config (done above)
- **Step 3** — Write `lead-routing/` directory with `docker-compose.yml`, `Caddyfile`, `.env.web`, `.env.engine`, `lead-routing.json`
- **Step 4** — Run `docker compose up -d` (pulls images from ghcr.io)
- **Step 5** — Run Prisma migrations + seed admin user
- **Step 6** — Poll `http://localhost:3000/api/health` + `http://localhost:3001/health` until both 200

**Expected final output:**
```
✔  Setup complete!

  Web app:        https://leads.openedgeai.tech
  Routing engine: https://engine.openedgeai.tech

  Admin email:    admin@openedgeai.tech
  Admin secret:   xxxxxxxxxxxxxxxx
                  run `lead-routing config show` to retrieve later

  Next steps:
  1. Ensure DNS A records for leads.openedgeai.tech and engine.openedgeai.tech
     point to this server — Caddy will auto-provision SSL certificates
  2. Open firewall ports 80 and 443
  3. Update your Salesforce Connected App callback URL to:
     https://leads.openedgeai.tech/api/auth/callback
  4. Run `lead-routing sfdc deploy` to install Apex triggers
  5. Open Salesforce → App Launcher → Lead Router Setup
     → Connect to Lead Router → complete the 4-step wizard
```

**Save the Admin Secret** — you'll need it to access admin features.

---

## Phase 3 — Verify Services Are Running

### On the VPS:

```bash
# Check all 5 containers are Up
docker compose -f ~/lead-routing/docker-compose.yml ps

# Expected: web, engine, postgres, redis, caddy — all "running"
```

```bash
# Check health endpoints directly on container ports
curl -s http://localhost:3000/api/health   # → {"status":"ok"}
curl -s http://localhost:3001/health       # → {"status":"ok"}
```

### HTTPS + SSL (wait ~30 seconds for Caddy to provision certs):

```bash
curl -s https://leads.openedgeai.tech/api/health    # → {"status":"ok"}
curl -s https://engine.openedgeai.tech/health       # → {"status":"ok"}
```

If HTTPS fails, check Caddy logs:
```bash
docker compose -f ~/lead-routing/docker-compose.yml logs caddy --tail=50
```

---

## Phase 4 — First Login to the Web App

1. Open **`https://leads.openedgeai.tech`** in a browser
2. You should see the login page — **not** a redirect loop or 502
3. Log in with the admin email + password you set during init
4. You should land on the **Onboarding** checklist page
5. Verify the page shows 4 onboarding steps (Connect Salesforce, Activate Triggers, Sync Fields, Test)

**Expected:** Dashboard loads, no errors in browser console about auth/session.

---

## Phase 5 — Deploy the Salesforce Package

Run this on a machine that has the **Salesforce CLI (`sf`) installed** and can reach your org. This can be your local machine.

```bash
npx @lead-routing/cli@latest sfdc deploy
```

> Or if using local build: `node dist/index.js sfdc deploy`

### What it prompts for:

| Prompt | Value |
|--------|-------|
| Org alias | `lead-routing` (or any alias you prefer) |
| Device login | Opens browser flow — visit the printed URL on any device, enter the code |

### What it does automatically:
- Copies + patches the SFDC package (sets Remote Site Setting URLs from `lead-routing.json`)
- Runs `sf project deploy start` — deploys Apex classes, triggers, custom objects, LWC, permission sets
- Assigns `LeadRouterAdmin` permission set to your user
- Creates `Routing_Settings__c` record with `App_Url__c` and `Engine_Endpoint__c`

**Expected final output:**
```
✔  Salesforce package deployed!

  Next steps:
  1. In Salesforce, open App Launcher → search "Lead Router Setup"
  2. Click "Connect to Lead Router" to authorise the OAuth connection
  3. Follow the 4-step wizard to activate triggers and sync field schema
```

---

## Phase 6 — In-Salesforce Setup Wizard

1. In Salesforce, open **App Launcher** (grid icon, top-left)
2. Search for **Lead Router Setup** → click it
3. Click **Connect to Lead Router**
   - This triggers an OAuth redirect to `https://leads.openedgeai.tech/api/auth/sfdc/callback`
   - You'll be asked to authorize the Connected App
   - After authorization, you're redirected back to Salesforce

4. **Step 1 — Check Connection Status**
   - Salesforce polls `https://leads.openedgeai.tech/api/setup/status`
   - Expected: "Connected" green checkmark within ~5 seconds

5. **Step 2 — Activate Triggers**
   - Click **Activate** — this enables `LeadTrigger` (and optionally Contact/Account triggers)
   - Expected: "Active" status shown

6. **Step 3 — Sync Field Schema**
   - Click **Sync Fields** — this calls the engine to index your Lead/Contact field metadata
   - Expected: Success message, field count shown

7. **Step 4 — Send Test Event**
   - Click **Send Test** — fires a synthetic lead route request to the engine
   - Expected: "Test successful" or "No matching rule" (both are valid — no rules configured yet)

---

## Phase 7 — Configure a Routing Rule and Test Live Routing

### 7a. In the Web App

1. Go to `https://leads.openedgeai.tech` → **Routing Rules**
2. Click **New Rule**
3. Set up a simple catch-all rule:
   - **Name:** `Test Rule`
   - **Conditions:** (leave empty = matches all leads)
   - **Assign to:** pick your Salesforce user (they should be listed after field sync)
   - **Priority:** 1
4. Click **Save** — the rule is now active

### 7b. Create a Test Lead in Salesforce

1. In Salesforce, go to **Leads → New**
2. Fill in: First Name `Test`, Last Name `Lead`, Company `ACME`
3. Click **Save**

### 7c. Verify Routing Happened

**In the web app:**
1. Go to `https://leads.openedgeai.tech` → **Routing History**
2. You should see a new log entry for the lead you just created
3. Status should be `SUCCESS`, Assigned To should be your Salesforce user

**In Salesforce:**
1. Open the Lead record you just created
2. **Owner** field should now show your Salesforce user

**Engine logs (optional, for debugging):**
```bash
docker compose -f ~/lead-routing/docker-compose.yml logs engine --tail=50
```

---

## Phase 8 — Smoke-Test Remaining CLI Commands

```bash
# Check all service health
lead-routing doctor

# Show current config
lead-routing config show

# Check container status
lead-routing status

# Tail logs for a service
lead-routing logs web
lead-routing logs engine
lead-routing logs postgres
```

---

## What to Do If Something Fails

| Symptom | Where to look | Fix |
|---------|---------------|-----|
| `docker compose up` hangs / fails | `docker compose logs` | Check image pull — is ghcr.io reachable? |
| Migrations fail | CLI output + `docker compose logs postgres` | Is port 5432 exposed? Is postgres healthy? |
| Health check times out | `curl http://localhost:3000/api/health` | Check web container logs |
| HTTPS 502 | `docker compose logs caddy` | Wait 30s for cert. Check DNS points to VPS IP |
| SFDC deploy fails auth | `sf org list` | Re-run device login |
| OAuth callback fails | Browser network tab | Check `SFDC_REDIRECT_URI` in `.env.web` matches Connected App exactly |
| Lead not routed | Engine logs | Is `Engine_Endpoint__c` set to public HTTPS URL? (not localhost) |
| Routing_Settings__c missing | SOQL in Salesforce | Re-run `lead-routing sfdc deploy` |

---

## Quick Teardown After Testing

```bash
cd ~/lead-routing
docker compose down -v   # stop + wipe volumes
cd ~
rm -rf lead-routing
```

This gives a clean slate for the next test run.
