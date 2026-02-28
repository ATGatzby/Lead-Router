# Lead Routing — Deployment Strategy

> Step-by-step guide to deploying the Lead Routing MVP to production for customer testing.

**Target domains**: `app.leadrouter.io` (web), `engine.leadrouter.io` (routing engine)

---

## Table of Contents

1. [Architecture: Local vs Production](#1-architecture-local-vs-production)
2. [Prerequisites](#2-prerequisites)
3. [Step 1 — PostgreSQL (Railway)](#3-step-1--postgresql-railway)
4. [Step 2 — Redis (Railway)](#4-step-2--redis-railway)
5. [Step 3 — Routing Engine (Railway)](#5-step-3--routing-engine-railway)
6. [Step 4 — Update SFDC Package](#6-step-4--update-sfdc-package)
7. [Step 5 — Web App (Vercel)](#7-step-5--web-app-vercel)
8. [Step 6 — Salesforce Connected App](#8-step-6--salesforce-connected-app)
9. [Step 7 — DNS & Custom Domains](#9-step-7--dns--custom-domains)
10. [Step 8 — Run Database Migrations](#10-step-8--run-database-migrations)
11. [Step 9 — Smoke Test Checklist](#11-step-9--smoke-test-checklist)
12. [Customer Onboarding Flow](#12-customer-onboarding-flow)
13. [Environment Variable Reference](#13-environment-variable-reference)
14. [Ongoing Operations](#14-ongoing-operations)
15. [Cost Estimate (MVP tier)](#15-cost-estimate-mvp-tier)

---

## 1. Architecture: Local vs Production

```
LOCAL DEV                           PRODUCTION
─────────────────────────────────   ─────────────────────────────────────
Next.js      localhost:3000         Vercel      https://app.leadrouter.io
Engine       localhost:3001         Railway     https://engine.leadrouter.io
PostgreSQL   Docker  localhost:5432  Railway     Managed PostgreSQL (prod DB)
Redis        Docker  localhost:6379  Railway     Managed Redis
ngrok        tunnel  → port 3001     (none)      Direct HTTPS to Railway engine
SFDC package Named Cred → ngrok     Named Cred  → engine.leadrouter.io
```

In production:
- **ngrok is eliminated** — SFDC calls the engine's Railway URL directly over HTTPS
- **Docker is eliminated** — managed services for PostgreSQL and Redis
- **SSL/TLS** is handled automatically by Vercel and Railway
- **Auto-deploys** trigger on every push to `main`

---

## 2. Prerequisites

### Accounts to create (all free tier available)

| Service | URL | Purpose |
|---|---|---|
| Railway | https://railway.app | Engine + PostgreSQL + Redis |
| Vercel | https://vercel.com | Web app (Next.js) |
| Namecheap / Cloudflare | — | Domain: leadrouter.io (or your brand) |

### CLI tools to install

```bash
# Railway CLI
npm install -g @railway/cli
railway login

# Vercel CLI
npm install -g vercel
vercel login

# Salesforce CLI (already installed)
sf --version
```

### Code repository
Push the project to a GitHub repository (Railway and Vercel both connect via GitHub):

```bash
cd "/Users/aruntyagi/Claude Code Projects/Lead Routing"
git init
git add .
git commit -m "Initial commit — Lead Routing MVP"
# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/lead-routing.git
git push -u origin main
```

---

## 3. Step 1 — PostgreSQL (Railway)

### 3.1 Create a Railway project

1. Go to https://railway.app → **New Project**
2. Choose **Empty Project**
3. Name it `lead-routing-prod`

### 3.2 Add PostgreSQL

1. In the project, click **+ New** → **Database** → **PostgreSQL**
2. Railway creates a managed PostgreSQL instance
3. Click the database service → **Variables** tab
4. Copy the `DATABASE_URL` connection string — it looks like:
   ```
   postgresql://postgres:PASSWORD@HOST.railway.internal:5432/railway
   ```
5. **Also copy the public URL** (for running migrations from your local machine):
   - Go to the PostgreSQL service → **Settings** → enable **Public Networking**
   - Copy the public `DATABASE_PUBLIC_URL`

> **Save both URLs** — you'll need them in later steps.

---

## 4. Step 2 — Redis (Railway)

### 4.1 Add Redis to the same Railway project

1. In the same project, click **+ New** → **Database** → **Redis**
2. Railway creates a managed Redis instance
3. Click the Redis service → **Variables** tab
4. Copy the `REDIS_URL` — it looks like:
   ```
   redis://default:PASSWORD@HOST.railway.internal:6379
   ```

> **Save this URL** — you'll need it for both the engine and web app.

---

## 5. Step 3 — Routing Engine (Railway)

### 5.1 Create Engine service

1. In the Railway project, click **+ New** → **GitHub Repo**
2. Select your `lead-routing` repository
3. Railway will ask which branch → select `main`
4. **Watch Directory**: set to `apps/engine` (tells Railway where the app lives in the monorepo)

   > If Railway doesn't support watch directory natively, use a `railway.json` file (see §5.3 below).

### 5.2 Configure Build & Start commands

In the Railway service **Settings** → **Build & Deploy**:

```
Build Command:   cd apps/engine && pnpm install && pnpm build
Start Command:   cd apps/engine && node dist/server.js
```

Or if you prefer to keep using tsx (simpler for MVP):
```
Build Command:   cd /app && pnpm install
Start Command:   cd apps/engine && node --import tsx src/server.ts
```

### 5.3 Create `railway.json` in the repo root (recommended)

Create this file so Railway knows about the monorepo structure:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "cd apps/engine && node --env-file=.env --import tsx src/server.ts",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

> **Note**: Add `tsx` to production dependencies in `apps/engine/package.json` if using this approach:
> ```bash
> cd apps/engine && pnpm add tsx
> ```

### 5.4 Set engine environment variables

In the Railway engine service → **Variables** tab, add:

```
DATABASE_URL        = <railway internal PostgreSQL URL from Step 1>
REDIS_URL           = <railway internal Redis URL from Step 2>
ENGINE_PORT         = 3000
LOG_LEVEL           = info
NODE_ENV            = production
```

> Railway assigns port via `PORT` env var — update `server.ts` to also check `process.env.PORT`:
> The current code already reads `ENGINE_PORT` — you can either add `ENGINE_PORT = ${{PORT}}` (Railway variable reference) or update `server.ts` line to read `process.env.PORT ?? process.env.ENGINE_PORT ?? 3001`.

### 5.5 Get the engine public URL

1. Railway service → **Settings** → **Networking** → **Generate Domain**
2. You get a URL like: `https://lead-routing-engine-production.up.railway.app`
3. Later you'll configure a custom domain: `engine.leadrouter.io`

---

## 6. Step 4 — Update SFDC Package

The SFDC package has two files that reference the old ngrok URL. Update them to the production engine URL.

### 6.1 Update Named Credential

**File**: `sfdc-package/force-app/main/default/namedCredentials/RoutingEngine.namedCredential-meta.xml`

Change `<endpoint>` from the ngrok URL to your production engine URL:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<NamedCredential xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>Routing Engine</label>
    <endpoint>https://engine.leadrouter.io</endpoint>
    <principalType>Anonymous</principalType>
    <protocol>NoAuthentication</protocol>
    <allowMergeFieldsInBody>false</allowMergeFieldsInBody>
    <allowMergeFieldsInHeader>false</allowMergeFieldsInHeader>
    <generateAuthorizationHeader>false</generateAuthorizationHeader>
</NamedCredential>
```

> If you haven't set up the custom domain yet, use the Railway URL temporarily:
> `https://lead-routing-engine-production.up.railway.app`

### 6.2 Update Remote Site Setting

**File**: `sfdc-package/force-app/main/default/remoteSiteSettings/LeadRouterNgrok.remoteSite-meta.xml`

Rename the file to `LeadRouterEngine.remoteSite-meta.xml` and update the contents:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<RemoteSiteSetting xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Lead Router production routing engine — allows outbound callouts from Apex triggers</description>
    <disableProtocolSecurity>false</disableProtocolSecurity>
    <fullName>LeadRouterEngine</fullName>
    <isActive>true</isActive>
    <url>https://engine.leadrouter.io</url>
</RemoteSiteSetting>
```

Also add a Remote Site Setting for the web app (needed by OnboardingController to call `/api/setup/status`):

Create `sfdc-package/force-app/main/default/remoteSiteSettings/LeadRouterApp.remoteSite-meta.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<RemoteSiteSetting xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Lead Router web app — allows OnboardingController callouts</description>
    <disableProtocolSecurity>false</disableProtocolSecurity>
    <fullName>LeadRouterApp</fullName>
    <isActive>true</isActive>
    <url>https://app.leadrouter.io</url>
</RemoteSiteSetting>
```

### 6.3 Redeploy SFDC package to customer orgs

```bash
sf project deploy start \
  --target-org lead-router \
  --metadata ApexClass \
  --metadata ApexTrigger \
  --metadata CustomObject \
  --metadata NamedCredential \
  --metadata LightningComponentBundle \
  --metadata RemoteSiteSettings
```

> **For each new customer org**: They install the package and the Named Credential already points to `engine.leadrouter.io`. No per-customer configuration needed — the `sfdcOrgId` in the payload identifies each customer.

---

## 7. Step 5 — Web App (Vercel)

### 7.1 Import project

1. Go to https://vercel.com → **Add New** → **Project**
2. Import your GitHub `lead-routing` repository
3. Vercel will auto-detect Next.js

### 7.2 Configure monorepo settings

In the Vercel project setup:
- **Framework Preset**: Next.js
- **Root Directory**: `apps/web`
- **Build Command**: `cd ../.. && pnpm install && cd apps/web && pnpm build`
  > Or use Vercel's turborepo preset if available

### 7.3 Set environment variables

In Vercel → **Settings** → **Environment Variables**, add all variables for **Production**:

```
DATABASE_URL          = <railway internal PostgreSQL URL>
REDIS_URL             = <railway internal Redis URL>
SESSION_SECRET        = <generate: openssl rand -hex 32>
SFDC_CLIENT_ID        = <Consumer Key from Salesforce Connected App>
SFDC_CLIENT_SECRET    = <Consumer Secret from Salesforce Connected App>
SFDC_REDIRECT_URI     = https://app.leadrouter.io/api/auth/callback
SFDC_LOGIN_URL        = https://login.salesforce.com
NEXT_PUBLIC_APP_URL   = https://app.leadrouter.io
NODE_ENV              = production
```

> **Generate SESSION_SECRET locally**:
> ```bash
> openssl rand -hex 32
> ```
> Copy the output — use it as your `SESSION_SECRET`. This must be at least 32 characters.

> **Important**: Railway's internal URLs (`*.railway.internal`) only work between Railway services. For Vercel (outside Railway), you need the **public** Railway URLs. Enable public networking on the Railway PostgreSQL and Redis services and use those public URLs for Vercel.

### 7.4 Deploy

Click **Deploy** — Vercel builds and deploys automatically. Every push to `main` auto-deploys.

Initial deploy URL: `https://lead-routing-web.vercel.app`

---

## 8. Step 6 — Salesforce Connected App

The Salesforce Connected App controls which callback URL is allowed for OAuth. This needs to match your production web app URL.

### 8.1 Option A: Use the existing metadata (recommended)

The file `sfdc-package/force-app/main/default/connectedApps/LeadRoutingApp.connectedApp-meta.xml` already has:
```xml
<callbackUrl>https://app.leadrouter.io/api/auth/callback</callbackUrl>
```

This is already correct for production. Deploy it with:
```bash
sf project deploy start --target-org lead-router --metadata ConnectedApp
```

> **Note**: ConnectedApp deployment can be finicky. If it fails, create it manually (Option B).

### 8.2 Option B: Create Connected App manually in Salesforce (safer)

For each customer org that needs to connect:

1. Go to Salesforce → **Setup** → **App Manager** → **New Connected App**
2. Fill in:
   - **Connected App Name**: Lead Router
   - **API Name**: Lead_Router
   - **Contact Email**: support@leadrouter.io
   - ✅ **Enable OAuth Settings**
   - **Callback URL**: `https://app.leadrouter.io/api/auth/callback`
   - **Selected OAuth Scopes**: `api`, `refresh_token`, `openid`
   - ❌ Uncheck **Require Proof Key for Code Exchange (PKCE)**
3. Save → wait 10 minutes for propagation
4. Click **Manage** → **Edit Policies** → set **IP Relaxation** to "Relax IP restrictions"
5. Copy the **Consumer Key** and **Consumer Secret**
6. Set `SFDC_CLIENT_ID` and `SFDC_CLIENT_SECRET` in Vercel env vars

---

## 9. Step 7 — DNS & Custom Domains

### 9.1 Purchase domain

Buy `leadrouter.io` (or your chosen domain) from Namecheap, Cloudflare, or your registrar.

### 9.2 Configure DNS records

In your DNS provider, add these records:

| Type | Name | Value | Purpose |
|---|---|---|---|
| CNAME | `app` | `cname.vercel-dns.com` | → Vercel (web app) |
| CNAME | `engine` | `*.up.railway.app` | → Railway (engine) |

> Vercel and Railway both show the exact DNS record to add in their dashboards.

### 9.3 Add domains in Vercel and Railway

**Vercel**:
1. Go to Project → **Settings** → **Domains**
2. Add `app.leadrouter.io`
3. Vercel auto-provisions SSL certificate

**Railway**:
1. Go to engine service → **Settings** → **Networking** → **Custom Domain**
2. Add `engine.leadrouter.io`
3. Railway auto-provisions SSL certificate

---

## 10. Step 8 — Run Database Migrations

The database is empty on first deploy. Run migrations to create all 12 tables.

### 10.1 From your local machine (using public Railway PostgreSQL URL)

```bash
cd packages/db

# Use the PUBLIC database URL (not the internal one)
DATABASE_URL="postgresql://postgres:PASSWORD@HOST.railway.app:PORT/railway" \
  pnpm prisma migrate deploy

# Verify tables were created
DATABASE_URL="postgresql://postgres:PASSWORD@HOST.railway.app:PORT/railway" \
  pnpm prisma studio
```

### 10.2 Alternatively, run via Railway CLI

```bash
railway run --service postgresql pnpm --filter @lead-routing/db prisma migrate deploy
```

### 10.3 For future schema changes

Always use migrations (never `db push` in production):
```bash
# Locally, create a new migration
cd packages/db
pnpm prisma migrate dev --name "describe_your_change"

# Then on deploy, Railway can run:
# pnpm prisma migrate deploy
```

Consider adding `prisma migrate deploy` to the engine's start command to auto-migrate on deploy:

In Railway engine service, update start command to:
```
cd apps/engine && node -e "require('@lead-routing/db').runMigrations()" && node --import tsx src/server.ts
```

Or simpler — add a `postinstall` script in the engine:
```json
"scripts": {
  "postinstall": "prisma migrate deploy",
  ...
}
```

---

## 11. Step 9 — Smoke Test Checklist

Run through this checklist after deploying to verify everything works end-to-end.

### Infrastructure ✓

- [ ] `https://app.leadrouter.io` loads the login page
- [ ] `https://engine.leadrouter.io/health` returns `{ "status": "ok" }`
- [ ] PostgreSQL: all 12 tables exist (verify via Prisma Studio or Railway DB view)
- [ ] Redis: ping returns PONG (via Railway Redis CLI)

### Authentication ✓

- [ ] Click "Connect Salesforce" on login page → redirects to `login.salesforce.com`
- [ ] Authorize → redirects back to `https://app.leadrouter.io/api/auth/callback`
- [ ] Lands on dashboard — sidebar loads with correct username
- [ ] Refresh page — still logged in (iron-session cookie persists)

### User Management ✓

- [ ] Navigate to `/license-users` — no error
- [ ] Click "Sync from Salesforce" — users appear
- [ ] Toggle a user's license ON — seat count increments

### Round-Robin Teams ✓

- [ ] Navigate to `/round-robins` — no error
- [ ] Create a team, add licensed users
- [ ] Reset pointer — no error

### Routing Rules ✓

- [ ] Navigate to `/routing-rules` — no error
- [ ] Create a rule with conditions and assign to a round-robin team
- [ ] Test Rule with a sample payload — shows "MATCH" or "NO MATCH"

### End-to-End Routing ✓

- [ ] In Salesforce, create a Lead matching the rule conditions
- [ ] Check engine logs in Railway → should see `POST /route → 200`
- [ ] Check `/history` page → routing log entry with STATUS = SUCCESS
- [ ] Check the Lead in Salesforce → OwnerId changed to the assigned user

### SFDC Package ✓

- [ ] No new `Routing_Error_Log__c` records after a successful routing
- [ ] Named Credential callout reaches `https://engine.leadrouter.io/route`
- [ ] Remote Site Setting allows callout to `https://engine.leadrouter.io`

---

## 12. Customer Onboarding Flow

This is the end-to-end journey a new customer takes to start using Lead Routing.

### Step 1 — Install the Salesforce Package

The customer installs your managed package from the AppExchange listing (or via install URL):

```
https://login.salesforce.com/packaging/installPackage.apexp?p0=<PACKAGE_VERSION_ID>
```

This installs:
- Apex triggers (Lead, Contact, Account)
- `RoutingEngineCallout.cls`, `RoutingPayloadBuilder.cls`
- `Routing_Settings__c` custom setting
- `Routing_Error_Log__c` custom object
- `RoutingEngine` named credential (pointing to `engine.leadrouter.io`)
- `onboardingWizard` LWC
- Remote Site Settings for app and engine

### Step 2 — Run the Onboarding Wizard

1. Customer goes to **App Launcher** → **Lead Router Onboarding**
2. The LWC wizard guides them through:
   - **Checking connection** — polls `https://app.leadrouter.io/api/setup/status` to see if their org is connected
   - Since they haven't connected yet, it shows a "Connect" button

### Step 3 — Connect to Lead Router Web App

1. Customer navigates to `https://app.leadrouter.io`
2. Clicks **"Connect Salesforce"** → authorizes OAuth
3. The app creates their Organization record in the DB (generates `webhookSecret` automatically)
4. Customer is redirected to the dashboard

### Step 4 — Configure Routing Settings in Salesforce

Back in the onboarding wizard:
1. The wizard detects the org is now connected (polls `/api/setup/status`)
2. Shows **Step 2: Configure Settings** — customer selects which objects/events to route (Lead INSERT, etc.)
3. Customer copies the **Webhook Secret** displayed in the wizard (fetched from `/api/setup/status`)
4. Customer pastes it into **Routing_Settings__c** → `Webhook_Secret__c` field
5. Customer clicks **Save Settings**

### Step 5 — Sync Field Schema

1. Wizard Step 3: customer clicks **Sync Fields** for Lead/Contact/Account
2. Calls `/api/fields/sync` which reads SFDC field metadata and stores it in `field_schemas` table
3. Fields are now available in the routing rule condition builder

### Step 6 — Create Routing Rules

1. Customer goes to `https://app.leadrouter.io/routing-rules`
2. Creates Round-Robin team(s) with licensed users
3. Creates routing rules with conditions and assignments
4. Activates rules

### Step 7 — Test It

1. Customer creates a Lead in Salesforce
2. Routing happens within ~5 seconds (async `@future` callout)
3. Customer checks the Lead — OwnerId should be updated
4. Customer checks the **History** tab in the Lead Router web app

---

## 13. Environment Variable Reference

### Web App (Vercel)

| Variable | Required | Example | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://...` | PostgreSQL connection string (Railway public URL) |
| `REDIS_URL` | ✅ | `redis://...` | Redis connection string (Railway public URL) |
| `SESSION_SECRET` | ✅ | 64-char hex | iron-session encryption key (`openssl rand -hex 32`) |
| `SFDC_CLIENT_ID` | ✅ | `3MVG9...` | Salesforce Connected App Consumer Key |
| `SFDC_CLIENT_SECRET` | ✅ | `ABC123...` | Salesforce Connected App Consumer Secret |
| `SFDC_REDIRECT_URI` | ✅ | `https://app.leadrouter.io/api/auth/callback` | Must match Connected App exactly |
| `SFDC_LOGIN_URL` | ✅ | `https://login.salesforce.com` | Use `https://test.salesforce.com` for sandboxes |
| `NEXT_PUBLIC_APP_URL` | ✅ | `https://app.leadrouter.io` | Used for absolute URL construction |
| `NODE_ENV` | ✅ | `production` | Enables secure cookies |

### Engine (Railway)

| Variable | Required | Example | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql://...` | PostgreSQL connection string (Railway internal URL) |
| `REDIS_URL` | ✅ | `redis://...` | Redis connection string (Railway internal URL) |
| `PORT` | auto | `3000` | Set by Railway automatically |
| `LOG_LEVEL` | optional | `info` | Pino log level: `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | optional | `production` | For any NODE_ENV-dependent behavior |

### Salesforce Custom Setting (per customer org)

| Field | Value | Notes |
|---|---|---|
| `Lead_Routing_Enabled__c` | `true` | Master switch |
| `Lead_Insert_Enabled__c` | `true` | Route on Lead creation |
| `Lead_Update_Enabled__c` | `false` | Keep false to avoid OwnerId update loop |
| `Contact_Routing_Enabled__c` | (as needed) | |
| `Account_Routing_Enabled__c` | (as needed) | |
| `Webhook_Secret__c` | 64-char hex | Copy from `/api/setup/status` response |

---

## 14. Ongoing Operations

### Viewing logs

**Engine logs** (Railway):
```bash
railway logs --service engine-service-name --tail
```
Or view in Railway dashboard → Service → **Logs** tab.

**Web app logs** (Vercel):
Vercel dashboard → Project → **Functions** tab → click any route → view logs.

### Re-deploying after code changes

```bash
git add .
git commit -m "your change"
git push origin main
# → Vercel and Railway auto-deploy from main
```

### Re-deploying SFDC package to a customer org

```bash
# First authenticate to their org
sf org login web --alias customer-org

# Deploy
sf project deploy start \
  --target-org customer-org \
  --metadata ApexClass \
  --metadata ApexTrigger \
  --metadata CustomObject \
  --metadata NamedCredential \
  --metadata LightningComponentBundle \
  --metadata RemoteSiteSettings
```

### Database backups
Railway automatically backs up PostgreSQL daily on paid plans. For MVP free tier, export manually:
```bash
railway run pg_dump $DATABASE_URL > backup-$(date +%Y%m%d).sql
```

### Scaling the engine

The routing engine is stateless (state is in Redis + PostgreSQL). To handle more load:
1. In Railway → Service → **Settings** → increase replicas
2. Redis pub/sub and round-robin Lua scripts are already thread-safe
3. BullMQ workers will scale automatically

### Adding a new customer

No infrastructure changes needed — the system is already multi-tenant:
1. Customer installs SFDC package (fixed Named Credential URL)
2. Customer connects to `https://app.leadrouter.io` via OAuth
3. A new `Organization` row is created with a unique `sfdcOrgId` and `webhookSecret`
4. Customer configures their `Webhook_Secret__c` in their SFDC Custom Setting
5. Done — routing starts working immediately

---

## 15. Cost Estimate (MVP Tier)

All services have generous free tiers suitable for initial customer testing (up to ~10 customers, low volume).

| Service | Free Tier | Paid Plan (if needed) |
|---|---|---|
| Vercel | 100GB bandwidth, unlimited deployments | $20/mo (Pro) |
| Railway | $5 free credit/mo, then ~$10–20/mo | ~$20–50/mo depending on usage |
| PostgreSQL (Railway) | 1GB storage | $5/mo per GB |
| Redis (Railway) | 25MB | $5/mo for 100MB |
| **Total MVP** | **~$0–5/mo** | **~$30–75/mo at scale** |

For 10 customers doing light testing, the free tiers should be sufficient for 2–4 weeks.

---

## Quick Reference: Key URLs

| URL | What it is |
|---|---|
| `https://app.leadrouter.io` | Customer-facing web app |
| `https://app.leadrouter.io/api/auth/callback` | OAuth callback (must be in Connected App) |
| `https://app.leadrouter.io/api/setup/status` | Public endpoint — polled by LWC onboarding wizard |
| `https://engine.leadrouter.io/health` | Engine health check |
| `https://engine.leadrouter.io/route` | SFDC webhook endpoint (via Named Credential) |
| `callout:RoutingEngine/route` | How Apex references the engine |
