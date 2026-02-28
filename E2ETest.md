# End-to-End Test: Fresh Customer Install

## What you have right now
- Existing install at `/Users/aruntyagi/Claude Code Projects/Lead Routing CLI/lead-routing/` (localhost URLs, no containers running)
- Salesforce CLI installed (`@salesforce/cli/2.123.1`)
- CLI code built but **not reinstalled globally** yet

---

## Phase 0 — One-Time: Get a Publicly Accessible URL

The Salesforce org needs to reach your **web app** (for OAuth callback) and **routing engine** (for callouts). Since you're on localhost, use ngrok.

```bash
# Terminal A — tunnel for web app
ngrok http 3000

# Terminal B — tunnel for routing engine
ngrok http 3001
```

Note both URLs, e.g.:
- `https://abc123.ngrok-free.app` → web app
- `https://def456.ngrok-free.app` → engine

> If you already have a paid ngrok account with static domains, use those instead — you won't have to restart tunnels.

---

## Phase 1 — Teardown Existing Install

```bash
# Step into the existing install dir and stop containers + remove volumes
cd "/Users/aruntyagi/Claude Code Projects/Lead Routing CLI/lead-routing"
docker compose down -v

# Go back and delete the install directory
cd ..
rm -rf lead-routing/
```

---

## Phase 2 — Rebuild & Reinstall CLI

```bash
cd "/Users/aruntyagi/Claude Code Projects/Lead Routing CLI/apps/cli"
pnpm build
npm install -g .

# Verify
lead-routing --version
lead-routing --help
```

You should see `sfdc` listed as a command.

---

## Phase 3 — Set Up Salesforce Connected App (if not done for this org)

> Skip if you already have a Connected App in your dev org from last time — just make sure the Callback URL matches your new ngrok web URL.

1. Log into your Salesforce Developer Edition org
2. **Setup → App Manager → New Connected App**
3. Fill in:
   - **Connected App Name**: `Lead Router`
   - **API Name**: `Lead_Router`
   - **Contact Email**: your email
   - ✅ **Enable OAuth Settings**
   - **Callback URL**: `https://abc123.ngrok-free.app/api/auth/callback` ← your web ngrok URL
   - **Selected OAuth Scopes**: `api`, `refresh_token`
4. Save → wait ~2 min → **Manage Consumer Details** → copy **Consumer Key** and **Consumer Secret**

---

## Phase 4 — Run `lead-routing init`

```bash
# Run from a test directory (the CLI creates ./lead-routing/ here)
cd ~
lead-routing init
```

Answer the prompts:

| Prompt | Value |
|---|---|
| App URL | `https://abc123.ngrok-free.app` (your web ngrok URL) |
| SFDC Login URL | `https://login.salesforce.com` |
| SFDC Consumer Key | ← from Connected App |
| SFDC Consumer Secret | ← from Connected App |
| Database | Docker-managed (press Enter) |
| Redis | Docker-managed (press Enter) |
| Admin email | your email |
| Admin password | any password |

Wait for all 6 steps to complete. At the end you'll see:
- Admin email + admin secret
- Hint: **"Next: run `lead-routing sfdc deploy`"**

---

## Phase 5 — Update Engine URL (critical for SFDC callouts)

The engine URL was hardcoded to `http://localhost:3001` during `init`. Before deploying to SFDC, update it in the config:

```bash
# Edit lead-routing.json to set the engine's public URL
nano ~/lead-routing/lead-routing.json
```

Change `"engineUrl"` to your engine ngrok URL:
```json
{
  "engineUrl": "https://def456.ngrok-free.app",
  "appUrl": "https://abc123.ngrok-free.app",
  ...
}
```

Also update `.env.web` so the web app knows the engine URL:
```bash
nano ~/lead-routing/.env.web
```
Find `ENGINE_URL=` and change it to `https://def456.ngrok-free.app`, then restart the web container:
```bash
cd ~/lead-routing && docker compose up -d --force-recreate web
```

---

## Phase 6 — Run `lead-routing sfdc deploy`

```bash
cd ~
lead-routing sfdc deploy
```

Steps it performs automatically:
1. Reads `lead-routing.json` — finds your engine + app URLs
2. Checks `sf` CLI is installed ✅
3. Prompts: **Salesforce org alias** → type `lead-routing` (or any alias)
4. Opens browser → log in to your Salesforce org → authorise
5. Copies + patches sfdc-package (Named Credential endpoint = engine ngrok URL)
6. Deploys: ApexClass, ApexTrigger, CustomObject, CustomField, NamedCredential, LWC, RemoteSiteSettings (~2 min)
7. Writes org settings: `App_Url__c` and `Engine_Endpoint__c` to `Routing_Settings__c`
8. Prints success + next steps

---

## Phase 7 — Verify the SFDC Side

In Salesforce, confirm these before opening the LWC:

1. **Setup → Named Credentials → RoutingEngine** → endpoint should be your engine ngrok URL
2. **Setup → Remote Site Settings → LeadRouterEngine** → URL should be your engine ngrok URL
3. **Setup → Custom Settings → Routing Settings → Manage** → should show `App_Url__c` and `Engine_Endpoint__c` filled in

---

## Phase 8 — Open the LWC Onboarding Wizard

1. In Salesforce, open **App Launcher** → search **"Lead Router Setup"**
2. The wizard should load (no errors — it reads `App_Url__c` from custom settings)
3. **Step 1 — Connect**: Click "Connect to Lead Router" → browser popup opens `https://abc123.ngrok-free.app/auth/sfdc?sfdcOrgId=...` → complete OAuth
4. After OAuth, the wizard polls until it detects the connection — should go green
5. **Step 2 — Configure**: Toggle Lead routing ON (Insert only for now), Save
6. **Step 3 — Sync Fields**: Click sync for Lead → should say N fields synced
7. **Step 4 — Activate**: Click Activate → done

---

## Phase 9 — Verify End-to-End Routing

1. Log in to web app at `https://abc123.ngrok-free.app`
   - Admin email + password from Phase 4
2. **License Users** → Sync → license yourself (or any user)
3. **Routing Rules** → Create Rule:
   - Object: Lead
   - Trigger: Insert
   - Assignment: User (pick licensed user)
   - No conditions (catch-all)
   - Activate it
4. In Salesforce → **Leads → New** → create a test lead
5. In web app → **History** → should show a SUCCESS entry for that lead

---

## Quick Reference — Troubleshooting

| Symptom | Check |
|---|---|
| LWC shows "App URL not set" | `lead-routing sfdc deploy` didn't run, or custom setting not written |
| Engine callout fails (401) | Webhook secret mismatch — run `lead-routing config show`, compare with `Webhook_Secret__c` in SFDC |
| SFDC OAuth callback fails | Callback URL in Connected App doesn't match ngrok web URL |
| Named Credential wrong URL | Edit `~/lead-routing/lead-routing.json` engine URL → re-run `lead-routing sfdc deploy` |
| Containers not running | `cd ~/lead-routing && docker compose up -d` |
