# Lead Routing — Architecture Document

> Auto-generated from production codebase audit on 2026-03-09

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Monorepo Structure](#2-monorepo-structure)
3. [High-Level Architecture](#3-high-level-architecture)
4. [Web App (apps/web)](#4-web-app-appsweb)
5. [Routing Engine (apps/engine)](#5-routing-engine-appsengine)
6. [CLI Installer (apps/cli)](#6-cli-installer-appscli)
7. [Salesforce Package (sfdc-package)](#7-salesforce-package-sfdc-package)
8. [Shared Packages](#8-shared-packages)
9. [Database Schema](#9-database-schema)
10. [Authentication & Authorization](#10-authentication--authorization)
11. [Routing Pipeline](#11-routing-pipeline)
12. [Infrastructure & Deployment](#12-infrastructure--deployment)
13. [Inter-Service Communication](#13-inter-service-communication)
14. [Analytics System](#14-analytics-system)
15. [Known Gotchas](#15-known-gotchas)

---

## 1. System Overview

Lead Routing is a self-hosted SaaS product that automates Salesforce lead/contact/account assignment. Customers deploy the full stack to their own VPS via a CLI installer. The system consists of four main components:

| Component | Tech | Port | Purpose |
|-----------|------|------|---------|
| **Web App** | Next.js 16, React 19 | 3000 | Management dashboard, API, OAuth |
| **Routing Engine** | Fastify v5 | 3001 | Real-time routing evaluation |
| **CLI** | Commander, node-ssh | — | Self-hosted deployment tool |
| **SFDC Package** | Apex, LWC | — | Salesforce triggers + onboarding wizard |

Supporting infrastructure: PostgreSQL 16, Redis 7, Caddy 2 (auto-HTTPS reverse proxy).

---

## 2. Monorepo Structure

```
lead-routing/
├── apps/
│   ├── web/                 @lead-routing/web      — Next.js 16 management UI
│   ├── engine/              @lead-routing/engine   — Fastify routing engine
│   └── cli/                 @lead-routing/cli      — Self-hosted installer CLI
│       └── sfdc-package/                           — Salesforce metadata (Apex, LWC, triggers)
├── packages/
│   ├── db/                  @lead-routing/db       — Prisma client + migrations
│   └── sfdc/                @lead-routing/sfdc     — jsforce helpers
├── package.json                                    — Root workspace (pnpm 10.30.1)
├── pnpm-workspace.yaml                             — Workspace: apps/*, packages/*
├── turbo.json                                      — Turborepo pipeline
├── tsconfig.base.json                              — Shared TS config (ES2022, NodeNext)
└── .dockerignore
```

**Tooling:** pnpm 10.30.1, Turborepo 2.8.10, TypeScript 5.9, Vitest

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CUSTOMER'S VPS                                    │
│                                                                             │
│  ┌──────────┐    ┌────────────────┐    ┌────────────────┐                  │
│  │  Caddy    │───▶│   Web App      │    │  Engine        │                  │
│  │  :80/:443 │    │   :3000        │    │  :3001         │                  │
│  │  auto-TLS │───▶│  Next.js 16    │    │  Fastify v5    │                  │
│  └──────────┘    │  Dashboard/API  │    │  Routing eval  │                  │
│                  └───────┬────────┘    └───────┬────────┘                  │
│                          │                     │                            │
│                          ▼                     ▼                            │
│                  ┌──────────────┐      ┌──────────────┐                    │
│                  │  PostgreSQL  │      │    Redis      │                    │
│                  │  :5432       │◀────▶│    :6379      │                    │
│                  │  16-alpine   │      │    7-alpine   │                    │
│                  └──────────────┘      └──────────────┘                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                          ▲                     ▲
                          │ OAuth + API         │ POST /route/batch (HMAC signed)
                          │                     │
                  ┌───────┴─────────────────────┴──────────┐
                  │           SALESFORCE ORG                │
                  │  Apex Triggers → @future callouts       │
                  │  Batch payload (up to 100 records/call) │
                  │  LWC Onboarding Wizard                  │
                  │  Routing_Settings__c (Custom Settings)  │
                  └────────────────────────────────────────┘
```

### Data Flow

```
1. Record(s) created/updated in Salesforce
        │
        ▼
2. Apex Trigger fires (LeadTrigger / ContactTrigger / AccountTrigger)
   IDs chunked into batches of 100
        │
        ▼
3. @future callout → POST /route/batch on Engine
   (HMAC-signed, all record fields, up to 100 records per call)
        │
        ▼
4. Engine validates, deduplicates (bulk Redis pipeline), pre-reserves quota
   Enqueues to BullMQ "routing-batch" queue → 202 Accepted
        │
        ▼
5. Parallel workers (10 concurrent, 20/sec rate limit) process each record:
        │
        ├─ Match Step: SOQL check for duplicates (excluding self)
        ├─ Branch Evaluation: AND/OR condition groups per path
        └─ Default Owner: Catch-all fallback
        │
        ▼
6. Resolve assignee (User / Round-Robin team / Queue)
        │
        ▼
7. jsforce updateOwner() → SFDC OwnerId updated
        │
        ▼
8. Routing log created in Postgres (SUCCESS/FAILED/RETRY)
```

---

## 4. Web App (apps/web)

**Stack:** Next.js 16.1.6 (App Router), React 19, Tailwind v4, shadcn/ui, TanStack Query v5, iron-session

### 4.1 API Routes (55 endpoints)

#### Authentication (8 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | Public | Email + password login (PBKDF2) |
| GET/POST | `/api/auth/register` | Public (invite token) | Validate invite / complete registration |
| GET | `/api/auth/me` | Session | Current user + org details |
| POST | `/api/auth/logout` | Session | Destroy session |
| GET | `/api/auth/sfdc/login` | Session | Initiate SFDC OAuth with PKCE |
| GET | `/api/auth/sfdc/callback` | Public | OAuth callback (CLI bridge or web) |
| POST | `/api/cli-auth/request` | Public | Create CLI auth session |
| GET | `/api/cli-auth/poll/[sessionId]` | Public | Poll CLI auth status |

#### Routing Rules (8 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/rules?object=LEAD` | Session | List rules (all rules if no object param, or filtered by object type) |
| POST | `/api/rules` | Session | Create rule (legacy or Route Builder) |
| GET | `/api/rules/[id]` | Session | Full rule detail with branches + matchConfig |
| PUT | `/api/rules/[id]` | Session | Update rule (wholesale replacement) |
| DELETE | `/api/rules/[id]` | Session | Delete rule |
| PATCH | `/api/rules/[id]/status` | Session | Toggle ACTIVE/INACTIVE |
| POST | `/api/rules/[id]/clone` | Session | Duplicate rule |
| POST | `/api/rules/[id]/test` | Session | Dry-run evaluation against sample record |
| POST | `/api/rules/reorder` | Session | Bulk priority reorder |

#### Routing Logs (6 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/routing-logs` | Session | Paginated search with filters (ruleId, teamId, etc.) |
| GET | `/api/routing-logs/failed` | Session | List failed logs |
| GET | `/api/routing-logs/stats` | Session | Aggregate statistics |
| GET | `/api/routing-logs/export` | Session | CSV export (supports ruleId, assignee, teamId filters + Team column) |
| POST | `/api/routing-logs/[id]/retry` | Session | Re-enqueue failed log to BullMQ |
| POST | `/api/routing-logs/[id]/dismiss` | Session | Mark log as dismissed |

#### Users & Licensing (9 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/users` | Session | Paginated user list |
| POST | `/api/users` | Session | Trigger SFDC user sync (4 modes: All, Individual, By Role, By Profile) |
| GET | `/api/users/[id]` | Session | User detail |
| POST | `/api/users/[id]/license` | Session | Grant license |
| POST | `/api/users/[id]/de-license` | Session | Revoke license |
| POST | `/api/users/bulk-license` | Session | Bulk license |
| POST | `/api/users/bulk-delete` | Session | Bulk delete |
| GET | `/api/users/stats` | Session | User metrics |
| GET | `/api/users/filters` | Session | Distinct roles and profiles from licensed+active users |

#### Teams / Round-Robin (7 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/teams` | Session | List teams with member counts |
| POST | `/api/teams` | Session | Create team |
| GET | `/api/teams/[id]` | Session | Team detail + members |
| PUT | `/api/teams/[id]` | Session | Update team |
| POST | `/api/teams/[id]/members` | Session | Add members (by userIds, roles, or profiles) |
| DELETE | `/api/teams/[id]/members/[userId]` | Session | Remove member |
| POST | `/api/teams/[id]/reset-pointer` | Session | Reset round-robin pointer |

#### Queues, Fields, Settings (6 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/queues` | Session | List SFDC queues |
| POST | `/api/queues/sync` | Session | Sync queues from SFDC |
| GET | `/api/fields?object=LEAD` | Session | List field schemas |
| POST | `/api/fields/sync` | X-Sfdc-Org-Id | Sync field schemas (called by Apex) |
| POST | `/api/settings/sync-sfdc` | Session | Push settings to Salesforce |
| POST | `/api/settings/notifications` | Session | Configure webhook notifications |

#### Setup & Onboarding (3 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/setup/status` | X-Sfdc-Org-Id | Check org connection (Apex polling) |
| POST | `/api/setup/onboarding-done` | X-Sfdc-Org-Id | Mark onboarding complete |
| GET | `/api/onboarding/status` | Session | Sidebar checklist progress |

#### Admin Portal (10 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/admin/auth/login` | ADMIN_SECRET | Admin login (HMAC token) |
| POST | `/api/admin/auth/logout` | Admin token | Destroy admin session |
| GET | `/api/admin/orgs` | Admin token | List all orgs |
| POST | `/api/admin/orgs` | Admin token | Pre-provision org + invite |
| GET | `/api/admin/orgs/[id]` | Admin token | Org detail |
| POST | `/api/admin/orgs/[id]/activate` | Admin token | Reactivate org |
| POST | `/api/admin/orgs/[id]/deactivate` | Admin token | Suspend org |
| POST | `/api/admin/orgs/[id]/plan` | Admin token | Change plan |
| POST | `/api/admin/orgs/[id]/seats` | Admin token | Update seat count |
| POST | `/api/admin/orgs/[id]/reset` | Admin token | Full org data reset |

#### Health
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/health` | Public | Docker healthcheck probe |

### 4.2 UI Pages

| Path | Purpose |
|------|---------|
| `/login` | Email + password login |
| `/register?token=...` | Invite-based registration |
| `/dashboard` | Main dashboard (redirect target) |
| `/routing-rules` | Rules list (flat list with Route Name, Object, Status toggle, Actions) |
| `/routing-rules/new` | Zapier-style Route Builder canvas |
| `/routing-rules/[id]/edit` | Edit existing rule |
| `/routing-rules/[id]/flow` | Flow visualization |
| `/activity` | Routing log viewer (with Route Rule and Team filter dropdowns) |
| `/activity/audit` | Audit log |
| `/activity/failed` | Failed routing logs |
| `/analytics` | Routing analytics dashboard |
| `/license-users` | License Users — sync by All, Individual, Role, or Profile; Team column |
| `/teams` | Teams management (renamed from Round Robins) |
| `/teams/[id]` | Team detail + members (add by individual, Role, or Profile) |
| `/settings` | Org settings |
| `/admin` | Admin portal |
| `/admin/orgs` | Org management |
| `/suspended` | Suspension notice |

### 4.3 Route Builder Component Architecture

```
RouteBuilder.tsx (main canvas)
├── StepRegistry.tsx          — Draggable step sidebar
├── Config Sheets (side panels):
│   ├── TriggerConfigSheet    — Object type + event + dry-run
│   ├── MatchConfigSheet      — Deduplication settings
│   ├── FilterConfigSheet     — Condition groups (AND/OR logic)
│   ├── ActionConfigSheet     — User / Round-Robin / Queue assignment
│   └── DefaultOwnerConfigSheet — Fallback assignment
├── Condition Builder:
│   ├── ConditionGroup.tsx    — AND group with OR connectors
│   ├── ConditionRow.tsx      — Field + Operator + Value
│   ├── FieldSelect.tsx       — Synced SFDC field dropdown
│   ├── OperatorSelect.tsx    — Context-aware operators by field type
│   └── ValueInput.tsx        — Text / Number / Date / Picklist
└── Types:
    └── types.ts              — RouteBuilderState, MatchConfig, PathAction, etc.
```

**Canvas Interaction:**
- Left-click drag on empty canvas pans the viewport (`onMouseDown` + window `mousemove`/`mouseup`)
- Nodes use `data-canvas-node` attribute to exclude themselves from pan detection
- Zoom: Ctrl/Cmd + scroll wheel only (prevents accidental trackpad zoom)
- Pan state uses refs (`panXRef`/`panYRef`) to avoid stale closures in event handlers
- Canvas breaks out of dashboard layout padding with `-m-6` + `calc(100% + 3rem)` height
- **Note:** `onPointerDown` does NOT work with Next.js 16 Turbopack — must use `onMouseDown`

**State Shape:**
```typescript
interface RouteBuilderState {
  name: string
  trigger: { objectType: "LEAD"|"CONTACT"|"ACCOUNT", triggerEvent: "INSERT"|"UPDATE"|"BOTH", isDryRun: boolean }
  matchConfig: MatchConfig | null
  paths: RoutePath[]          // Each path = filter conditions + assignment action
  defaultOwner: DefaultOwner | null
}
```

### 4.4 Utility Libraries (lib/)

| File | Purpose |
|------|---------|
| `auth.ts` | `getOrgIdFromHeaders()`, `getActorFromHeaders()` — read proxy-injected headers |
| `session.ts` | SessionData interface, `getSession()`, `requireSession()` (iron-session) |
| `admin-auth.ts` | HMAC-SHA256 admin token signing + validation (8h TTL) |
| `redis.ts` | Singleton ioredis client (lazyConnect) |
| `routing-queue.ts` | BullMQ queue for retry jobs (dedicated Redis conn) |
| `evaluator.ts` | `evaluateRule()` — dry-run condition evaluation (AND/OR groups) |
| `operators.ts` | Operator definitions by field type (TEXT, NUMBER, DATE, PICKLIST, etc.) |
| `org-status.ts` | Redis-backed org suspension check (`org:suspended:{orgId}`) |
| `cli-auth-store.ts` | In-memory CLI OAuth session store (10-min TTL) |
| `crypto.ts` | PBKDF2 password hashing, webhook secret generation, HMAC verification |
| `builder-to-rule.ts` | `builderToApiBody()` / `apiRuleToBuilderState()` — UI ↔ API conversion |
| `invalidate-rules-cache.ts` | Redis pub/sub to engine (`rules:invalidate` channel) |
| `utils.ts` | `cn()` — Tailwind class merge helper |

### 4.5 UI Design System & Modernization

**Theme:** Tailwind v4 with CSS custom properties in oklch color space. Dark mode supported via `next-themes` (ThemeProvider in `providers.tsx`).

| Surface | Token | Value |
|---------|-------|-------|
| Sidebar | `--sidebar` | `oklch(0.18 0.04 265)` — dark navy with light text |
| Content background | `--background` | `oklch(0.985 0.002 250)` — off-white so white cards pop |
| Topbar | — | Glass effect with `backdrop-blur-sm` |

**Toast System:** Sonner (`sonner` package) replaces hand-rolled toast state. `<Toaster richColors position="bottom-right" />` in root layout. Pages use `toast.success()` / `toast.error()` from sonner.

**Skeleton Components:**
- `components/skeletons/table-skeleton.tsx` — configurable rows/columns skeleton for tables
- `components/skeletons/card-skeleton.tsx` — configurable count skeleton for card grids

**Design Tokens:**

| Element | Style |
|---------|-------|
| Sidebar | Dark navy bg, white overlay accents, muted text variants |
| Tables | `bg-muted/40` header tint, `rounded-xl` containers, `shadow-sm` |
| Cards | `shadow-sm hover:shadow-md transition-all duration-200` |
| Status badges | Dot indicator + dark mode variants |
| Filter bars | Wrapped in `rounded-xl border bg-card p-3 shadow-sm` |
| Empty states | Icon in `h-20 w-20 rounded-full bg-muted/50` circle with help text |
| Login | Gradient background, elevated card shadow |

---

## 5. Routing Engine (apps/engine)

**Stack:** Fastify v5.3.2, BullMQ v5.51, ioredis v5.6, tsup (CJS output)

### 5.1 Endpoints

```
POST /route         — Single-record webhook (legacy, still supported)
POST /route/batch   — Batch ingestion (up to 200 records per call)
GET  /health
```

### 5.2 Request Validation Pipeline (POST /route)

```
POST /route
  │
  ├─ 1. Parse JSON (capture raw body for HMAC)
  ├─ 2. Validate required fields (sfdcOrgId, objectType, eventType, recordId, fields)
  ├─ 3. Load org by sfdcOrgId (Prisma)
  ├─ 4. Verify HMAC-SHA256 signature (X-Signature-256 header)
  ├─ 5. Check org.isActive (403 if suspended)
  ├─ 6. Lazy quota reset (if past quotaResetAt, reset to 0)
  ├─ 7. Check routing quota (429 if exceeded)
  ├─ 8. Check idempotency via Redis (duplicate → 200 "duplicate")
  └─ 9. Route record → { status, latencyMs }
```

**Response statuses:** `routed` | `unmatched` | `dry_run` | `merged` | `duplicate`

### 5.2b Batch Pipeline (POST /route/batch)

```
POST /route/batch
  │
  ├─ 1. Validate top-level fields + records[] (max 200)
  ├─ 2. Load org by sfdcOrgId + verify HMAC (once for entire batch)
  ├─ 3. Check org.isActive (403) + lazy quota reset
  ├─ 4. Quota gate (429 if remaining <= 0)
  ├─ 5. Bulk idempotency check via Redis pipeline (claimIdempotencyKeys)
  ├─ 6. Filter non-duplicates, cap to remaining quota
  ├─ 7. Pre-reserve quota atomically (increment by N)
  └─ 8. Enqueue to BullMQ "routing-batch" queue → 202 { accepted, duplicates, batchId }
```

**Batch Worker:** 10 concurrent workers, rate-limited to 20 jobs/sec. Each job calls `routeRecord()` — same function as `/route`. On completion, decrements quota for `unmatched`/`dry_run` results. Failed after 3 retries → decrement quota, create FAILED routing log, log as DLQ.

**Failure Logging:** All rejection scenarios create FAILED routing logs with descriptive error messages — org suspended (403), quota exceeded (429), quota-capped records, batch worker DLQ, and unhandled errors (500). These appear in the Activity → Failed view in the dashboard.

### 5.3 Module Inventory

| File | Purpose |
|------|---------|
| `server.ts` | Fastify setup, startup sequence, raw body parser |
| `routes/route.ts` | POST /route + POST /route/batch handlers, auth/quota/idempotency checks |
| `router.ts` | Core routing logic — new-style (branches) + legacy modes |
| `evaluator.ts` | Condition evaluation engine (20 operators, AND/OR groups) |
| `cache.ts` | In-memory rule cache, `loadAllRules()`, pub/sub listener |
| `queue.ts` | BullMQ queue + worker for retry jobs |
| `batch-queue.ts` | BullMQ queue `routing-batch` + parallel worker (concurrency 10, rate limit 20/sec) |
| `redis.ts` | ioredis singleton (`maxRetriesPerRequest: null` for BullMQ) |
| `sfdc.ts` | jsforce connection caching, SFDC ID lookups |
| `webhook.ts` | Fire-and-forget notification webhook (3s timeout) |
| `idempotency.ts` | Single + bulk Redis idempotency (`claimIdempotencyKey` + `claimIdempotencyKeys` pipeline) |
| `round-robin.ts` | Atomic Redis Lua script for pointer increment |
| `middleware/validate-signature.ts` | HMAC-SHA256 verification |

### 5.4 Condition Operators (20)

| Operator | Description |
|----------|-------------|
| `is_blank` / `is_not_blank` | Null, undefined, or empty string |
| `is_true` / `is_false` | Boolean or string "true"/"false" |
| `equals` / `not_equals` | String comparison (coerced) |
| `contains` / `not_contains` | Case-insensitive substring |
| `starts_with` | Case-insensitive prefix |
| `gt` / `lt` / `gte` / `lte` | Numeric comparison |
| `before` / `after` / `within_last` | Date/time (within_last = days) |
| `includes` / `excludes` | Semicolon-delimited picklist values |

### 5.5 Assignment Resolution

| Type | Mechanism |
|------|-----------|
| **USER** | Lookup `sfdcUserId` from `users` table → `updateOwner()` |
| **ROUND_ROBIN** | Atomic Redis Lua `INCR + modulo` → next team member → `updateOwner()` |
| **QUEUE** | Lookup `sfdcQueueId` from `sfdcQueues` table → `updateOwner()` |

### 5.6 Retry & Error Handling

**Retry Queue (routing-retries):**
```
SFDC updateOwner() fails
    │
    ▼
Create RoutingLog (status: RETRY)
    │
    ▼
Enqueue BullMQ job (queue: "routing-retries")
    │
    ├─ Attempt 1: 2s delay
    ├─ Attempt 2: 8s delay
    └─ Attempt 3: 32s delay
         │
         ├─ Success → Log = SUCCESS, increment quota
         └─ All fail → Log = FAILED (visible in dashboard)
```

**Batch Queue (routing-batch):**
```
POST /route/batch → bulk idempotency → enqueue N jobs
    │
    ▼
10 concurrent workers (rate-limited 20/sec)
    │
    ├─ Each job: routeRecord() → same pipeline as /route
    ├─ On complete (unmatched/dry_run): decrement pre-reserved quota
    └─ On failed (3 retries): decrement quota, log DLQ
```

---

## 6. CLI Installer (apps/cli)

**Stack:** Commander, @clack/prompts, node-ssh v13.2.1, tsup (ESM)

### 6.1 Commands

| Command | Purpose |
|---------|---------|
| `lead-routing init` | Interactive 9-step deployment wizard |
| `lead-routing deploy` | Update live installation (pull + restart + migrate) |
| `lead-routing doctor` | Health check (Docker, containers, HTTP endpoints) |
| `lead-routing logs [service]` | Stream container logs |
| `lead-routing status` | Docker container status |
| `lead-routing config show` | Display installation config |
| `lead-routing config sfdc` | Update SFDC OAuth credentials |
| `lead-routing sfdc deploy` | Deploy/redeploy Salesforce package |
| `lead-routing uninstall` | Full teardown |

### 6.2 Init Flow

```
                    LOCAL MACHINE                              REMOTE VPS
                    ─────────────                              ──────────
Step 1: Prerequisites
  ├─ Check Node 20+
  └─ Check sf CLI installed

Step 2: Collect SSH Config
  └─ host, port, user, password/key, remoteDir

Step 3: Collect App Config
  ├─ App URL, Engine URL
  ├─ SFDC client ID/secret/login URL
  ├─ Admin email + password
  └─ Auto-generate: dbPassword, sessionSecret,
     engineWebhookSecret, adminSecret

Step 4: Generate Files (locally)
  ├─ docker-compose.yml
  ├─ Caddyfile
  ├─ .env.web
  ├─ .env.engine
  └─ lead-routing.json

Step 5: Check Remote Prerequisites ──────────────▶ Verify Docker (auto-install)
                                                   Free ports 80/443
                                                   Stop conflicting services

Step 6: Upload Files ────────────────────────────▶ SFTP 5 files to remoteDir

Step 7: Start Services ──────────────────────────▶ docker compose pull + up

Step 8: Run Migrations
  ├─ SSH tunnel to Postgres ◀────────────────────  Tunnel port 5432
  ├─ prisma migrate deploy (via tunnel)
  └─ Seed admin user (raw SQL INSERT)

Step 9: Verify Health
  ├─ Poll GET {appUrl}/api/health (24 × 5s)
  └─ Poll GET {engineUrl}/health

Step 10: SFDC Deploy
  ├─ Patch Remote Site Settings XML with URLs
  ├─ sf project deploy start (runs locally)
  └─ Update Routing_Settings__c custom settings
```

### 6.3 Generated Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Service definitions (web, engine, postgres, redis, caddy) |
| `Caddyfile` | HTTPS reverse proxy with auto Let's Encrypt |
| `.env.web` | Web app env (DATABASE_URL, REDIS_URL, SFDC OAuth, session secret) |
| `.env.engine` | Engine env (DATABASE_URL, REDIS_URL, webhook secret) |
| `lead-routing.json` | Install metadata (URLs, SSH config for subsequent commands) |

---

## 7. Salesforce Package (sfdc-package)

### 7.1 Apex Classes

| Class | Purpose |
|-------|---------|
| `RoutingEngineCallout` | `@future(callout=true)` — builds batch payload, signs with HMAC, POSTs to `/route/batch` (single call per chunk of up to 100 records) |
| `RoutingPayloadBuilder` | `build()` — single-record payload (legacy); `buildBatch()` — batch payload with `records[]` array |
| `OnboardingController` | `@AuraEnabled` methods for LWC wizard (9 methods: check connection, save settings, sync fields, send test event) |
| `RoutingEngineMock` | `HttpCalloutMock` for unit tests |

### 7.2 Triggers

| Trigger | Object | Events | Logic |
|---------|--------|--------|-------|
| `LeadTrigger` | Lead | after insert, after update | Check `Routing_Settings__c` flags → chunk IDs (100 per batch) → `RoutingEngineCallout.sendAsync()` |
| `ContactTrigger` | Contact | after insert, after update | Same pattern for Contact routing |
| `AccountTrigger` | Account | after insert, after update | Same pattern for Account routing |

### 7.3 Custom Settings & Objects

**`Routing_Settings__c`** (Hierarchy Custom Setting):

| Field | Type | Purpose |
|-------|------|---------|
| `Engine_Endpoint__c` | Text(255) | Public engine URL |
| `App_Url__c` | Text(255) | Public web app URL |
| `Webhook_Secret__c` | Text(255) | HMAC signing secret |
| `Lead_Routing_Enabled__c` | Boolean | Master toggle |
| `Lead_Insert_Enabled__c` | Boolean | Route on insert |
| `Lead_Update_Enabled__c` | Boolean | Route on update |
| `Contact_*` | Boolean×3 | Same pattern |
| `Account_*` | Boolean×3 | Same pattern |

**`Routing_Error_Log__c`** (Custom Object):

| Field | Type | Purpose |
|-------|------|---------|
| `Payload__c` | LongText(131072) | Request payload |
| `Status_Code__c` | Number | HTTP status |
| `Response_Body__c` | LongText | Response body |
| `Created_At__c` | DateTime | Timestamp |

### 7.4 LWC Onboarding Wizard

4-step wizard deployed as a Lightning App Page:

```
Step 1: Connect Org
  └─ OAuth popup → polls checkConnectionStatus() every 3s (max 40 attempts)

Step 2: Activate Triggers
  ├─ Toggle Lead/Contact/Account routing (insert/update)
  ├─ "Send Test Event" button
  └─ Saves to Routing_Settings__c

Step 3: Sync Field Schema
  └─ POST /api/fields/sync for each enabled object

Step 4: Done
  └─ markOnboardingDone() + "Open Lead Router" link
```

### 7.5 Supporting Metadata

| Type | Name | Purpose |
|------|------|---------|
| Remote Site Setting | `LeadRouterEngine` | Engine URL (patched by CLI) |
| Remote Site Setting | `LeadRouterApp` | Web app URL (patched by CLI) |
| Named Credential | `RoutingEngine` | Legacy (not used for routing) |
| Custom App | `Lead_Router_Setup` | Lightning app for onboarding tab |
| Custom Tab | `Lead_Router_Setup` | Hosts onboardingWizard LWC |
| Permission Set | `LeadRouterAdmin` | Access to setup app + tab |

---

## 8. Shared Packages

### 8.1 @lead-routing/db (packages/db)

Prisma ORM wrapper exporting singleton client + generated types.

**Exports:**
- `prisma` — PrismaClient singleton (dev-mode hot-reload via globalThis)
- All Prisma-generated types
- `PLAN_LIMITS` / `getPlanLimits()` — plan-specific quotas
- `RULES_INVALIDATE_CHANNEL` — Redis channel constant

**Migrations (5):**
1. `20260101000000_init` — Initial schema
2. `20260223000000_add_routing_log_dismissed` — Add dismissedAt
3. `20260224000000_add_org_notification_webhook` — Add notificationWebhookUrl
4. `20260227000000_self_hosted_schema_updates` — SFDC columns nullable, app_users/invites, plan/quota
5. `20260308100000_route_match_config` — Route Builder tables (branches, match config, default owner)

### 8.2 @lead-routing/sfdc (packages/sfdc)

jsforce v2 wrapper for Salesforce API operations.

| Module | Exports |
|--------|---------|
| `client.ts` | `getSfdcAuthUrl()`, `exchangeCodeForTokens()`, PKCE helpers |
| `schema.ts` | `syncFieldSchema()` — describe → upsert field_schemas |
| `users.ts` | Sync SFDC users to local DB |
| `queues.ts` | Sync SFDC queues to local DB |
| `settings.ts` | `pushSettings()` — write to Routing_Settings__c |
| `update-owner.ts` | `updateOwner()` — jsforce .update({ OwnerId }) |
| `merge-lead.ts` | Lead merge via SOAP API |
| `operators.ts` | Operator definitions |

---

## 9. Database Schema

### 9.1 Entity Relationship Diagram

```
Organization (1)
  │
  ├──▶ AppUser (*)           — Dashboard login users
  ├──▶ Invite (*)            — Registration invites
  ├──▶ User (*)              — Synced SFDC users
  ├──▶ RoundRobinTeam (*)
  │      └──▶ TeamMember (*) — Links User ↔ Team
  ├──▶ SfdcQueue (*)
  ├──▶ FieldSchema (*)
  ├──▶ RoutingRule (*)
  │      ├──▶ RuleCondition (*)     — Legacy conditions
  │      ├──▶ RoutingBranch (*)     — Route Builder paths
  │      │      └──▶ BranchCondition (*)
  │      └──▶ RouteMatchConfig (0..1) — Dedup settings
  ├──▶ RoutingLog (*)
  ├──▶ AuditLog (*)
  └──▶ BillingInfo (0..1)
```

### 9.2 Enums

| Enum | Values |
|------|--------|
| `SfdcObjectType` | LEAD, CONTACT, ACCOUNT |
| `TriggerEvent` | INSERT, UPDATE, BOTH |
| `RuleStatus` | ACTIVE, INACTIVE |
| `AssignmentType` | USER, ROUND_ROBIN, QUEUE |
| `TeamMemberStatus` | ACTIVE, PAUSED |
| `RoutingStatus` | SUCCESS, FAILED, UNMATCHED, RETRY, MERGED |
| `LeadMatchAction` | SFDC_MERGE, ASSIGN_TO_OWNER, ASSIGN_CUSTOM |
| `ContactMatchAction` | ASSIGN_TO_OWNER, ASSIGN_CUSTOM, SKIP |
| `AccountMatchAction` | ASSIGN_TO_OWNER, ASSIGN_CUSTOM, SKIP |
| `Plan` | FREE, PAID |

### 9.3 Key Models

**Organization** — Multi-tenant workspace
- SFDC OAuth tokens (accessToken, refreshToken, instanceUrl)
- webhookSecret (HMAC for engine auth)
- plan, isActive, seatsPurchased, seatsUsed, routingQuotaUsed, quotaResetAt

**RoutingRule** — Routing logic definition
- Legacy: single assignmentType + conditions
- Route Builder: branches[] + matchConfig? + defaultOwner*

**RoutingBranch** — Path in Route Builder
- priority-ordered, each with conditions[] + assignment

**RouteMatchConfig** — Deduplication matching
- checkLeads/Contacts/Accounts, matchEmail/Phone/Domain
- onLeadMatch/Contact/Account actions

**RoutingLog** — Audit trail
- status (SUCCESS/FAILED/UNMATCHED/RETRY/MERGED)
- recordSnapshot (full incoming payload JSON)
- teamId, teamName — populated by the engine for ROUND_ROBIN assignments
- routingDurationMs — ms from webhook receipt to SFDC assignment
- branchId — FK to RoutingBranch for path-level analytics

---

## 10. Authentication & Authorization

### 10.1 Authentication Flows

```
┌─────────────────────────────────────────────────────────────┐
│                    AUTH MECHANISMS                           │
├─────────────────┬───────────────────────────────────────────┤
│ Web Dashboard   │ iron-session cookie (lr_session)          │
│                 │ PBKDF2-SHA256 password (310k iterations)  │
│                 │ 7-day cookie maxAge                       │
├─────────────────┼───────────────────────────────────────────┤
│ Admin Portal    │ HMAC-SHA256 signed token (admin_token)    │
│                 │ Login with ADMIN_SECRET env var            │
│                 │ 8-hour token lifespan                     │
├─────────────────┼───────────────────────────────────────────┤
│ SFDC OAuth      │ OAuth 2.0 + PKCE (code_challenge)         │
│                 │ Verifier in sfdc_pkce_verifier cookie      │
│                 │ CLI bridge: in-memory token store          │
├─────────────────┼───────────────────────────────────────────┤
│ Apex Callouts   │ X-Sfdc-Org-Id header (org lookup)         │
│ (to web app)    │ PUBLIC_PREFIXES bypass in proxy.ts         │
├─────────────────┼───────────────────────────────────────────┤
│ Engine Webhook  │ HMAC-SHA256 signature (X-Signature-256)   │
│ (from Apex)     │ Signed with per-org webhookSecret          │
└─────────────────┴───────────────────────────────────────────┘
```

### 10.2 Proxy (proxy.ts)

Next.js 16 uses `proxy.ts` (NOT `middleware.ts`). On every request:

1. Allow static files and `PUBLIC_PREFIXES`
2. Check admin routes (admin_token cookie)
3. Decrypt iron-session → validate `session.orgId`
4. Check org suspension via Redis
5. Inject headers: `x-org-id`, `x-user-id`, `x-user-name`
6. Continue to route handler

---

## 11. Routing Pipeline

### 11.1 New-Style Routing (Route Builder)

```
Rule has branches[] OR matchConfig OR defaultOwnerType
    │
    ▼
┌─────────────────────────┐
│   MATCH STEP (optional) │
│   If matchConfig exists:│
│   ├─ SOQL: find Lead    │──▶ onLeadMatch:  SFDC_MERGE / ASSIGN_TO_OWNER / ASSIGN_CUSTOM
│   ├─ SOQL: find Contact │──▶ onContactMatch: ASSIGN_TO_OWNER / ASSIGN_CUSTOM / SKIP
│   └─ SOQL: find Account │──▶ onAccountMatch: ASSIGN_TO_OWNER / ASSIGN_CUSTOM / SKIP
└─────────┬───────────────┘
          │ no match or SKIP
          ▼
┌─────────────────────────┐
│   BRANCH EVALUATION     │
│   For each branch       │
│   (priority-ordered):   │
│   ├─ Evaluate conditions│
│   │   (AND within group,│
│   │    OR across groups) │
│   └─ If match:          │
│       resolve assignee  │──▶ updateOwner() → SUCCESS or RETRY
└─────────┬───────────────┘
          │ no branch matched
          ▼
┌─────────────────────────┐
│   DEFAULT OWNER         │
│   (catch-all fallback)  │──▶ resolve assignee → updateOwner()
└─────────────────────────┘
```

### 11.2 Legacy Routing

```
Rule has NO branches and NO matchConfig
    │
    ▼
Evaluate rule.conditions (AND/OR groups)
    │
    ├─ Match → resolve single assignee → updateOwner()
    └─ No match → next rule (or UNMATCHED)
```

### 11.3 Round-Robin Algorithm

```
Redis Lua Script (atomic):
  INCR rr:{orgId}:{teamId}:pointer
  RETURN (value - 1) % memberCount

Members: sorted by createdAt ASC, filtered to ACTIVE status
Pointer: persistent across requests, reset via API
```

---

## 12. Infrastructure & Deployment

### 12.1 Docker Architecture

```
┌─────────────────────────────────────────────────────┐
│  docker-compose.yml (generated by CLI)              │
│                                                     │
│  caddy:2-alpine ─── :80, :443 (auto-TLS)           │
│    ├─ leads.example.com → web:3000                  │
│    └─ engine.example.com → engine:3001              │
│                                                     │
│  ghcr.io/lead-routing/web:latest ─── 127.0.0.1:3000│
│    └─ Next.js standalone (node apps/web/server.js)  │
│                                                     │
│  ghcr.io/lead-routing/engine:latest ── 127.0.0.1:3001│
│    └─ Node CJS bundle (node dist/server.js)         │
│                                                     │
│  postgres:16-alpine ─── 127.0.0.1:5432              │
│    └─ Volume: postgres_data                         │
│                                                     │
│  redis:7-alpine ─── 6379 (internal only)            │
│    └─ Volume: redis_data                            │
└─────────────────────────────────────────────────────┘
```

### 12.2 Docker Image Build

**Web (apps/web/Dockerfile):**
- Builder: Node 24 Alpine → pnpm install → prisma generate → next build (standalone)
- Runner: Node 24 Alpine → `.next/standalone` + static + Prisma binaries

**Engine (apps/engine/Dockerfile):**
- Builder: Node 24 Alpine → pnpm install → prisma generate → tsup (CJS bundle)
- Runner: Node 24 Alpine → `dist/server.js` + prod deps + Prisma binaries

### 12.3 Cross-Platform Build

Local Mac (ARM64) → VPS (AMD64): requires `docker buildx build --platform linux/amd64`

---

## 13. Inter-Service Communication

### 13.1 Redis Channels & Keys

| Type | Key/Channel | Purpose |
|------|-------------|---------|
| Pub/Sub | `rules:invalidate` | Web → Engine: reload rules from DB |
| Key | `org:suspended:{orgId}` | Org suspension flag (web proxy check) |
| Key | `rr:{orgId}:{teamId}:pointer` | Round-robin pointer (Lua atomic INCR) |
| Key | `idem:{orgId}:{recordId}:{event}:{ts}` | Idempotency (1h TTL, SET NX) |
| Queue | `routing-retries` | BullMQ job queue (web enqueue, engine consume) |
| Queue | `routing-batch` | BullMQ batch processing queue (10 concurrent workers, 20/sec rate limit) |
| Queue | `analytics-reconciliation` | Nightly aggregate reconciliation + conversion check jobs |

### 13.2 Communication Patterns

```
Web App ──── Redis pub/sub ────▶ Engine        (cache invalidation)
Web App ──── BullMQ (Redis) ───▶ Engine        (retry jobs)
Web App ──── Postgres ─────────▶ Engine        (shared DB, no direct calls)
Web App ◀─── jsforce ──────────▶ Salesforce    (OAuth, user/field sync)
Engine  ◀─── HTTP POST /route/batch ── Salesforce (Apex trigger batch webhooks)
Engine  ──── jsforce ──────────▶ Salesforce    (updateOwner, merge, SOQL)
CLI     ──── SSH + SFTP ───────▶ VPS           (deploy files, run commands)
CLI     ──── sf CLI ───────────▶ Salesforce    (deploy metadata)
```

---

## 14. Analytics System

### 14.1 Data Model

**RoutingLog additions:** `routingDurationMs` (Int?) captures ms from webhook receipt to SFDC assignment. `branchId` (String?) links to the matching RoutingBranch for path-level analytics.

**RoutingDailyAggregate** — Pre-computed daily rollups (star-schema flat table):
- Nullable dimension columns: `ruleId`, `pathLabel`, `branchId`, `teamId`, `assigneeId`, `objectType` — where NULL = "all"
- Metrics: `successCount`, `failedCount`, `unmatchedCount`, `mergedCount`, `totalCount`, `avgDurationMs`, `minDurationMs`, `maxDurationMs`, `p50DurationMs`, `p95DurationMs`
- Unique index: `(orgId, date, ruleId, pathLabel, teamId, assigneeId, objectType)`

**ConversionTracking** — Lead → Opportunity conversion for ROI:
- Created when a Lead is successfully routed
- Fields: `sfdcLeadId`, `isConverted`, `convertedAt`, `opportunityId`, `opportunityAmount`, `opportunityStageName`
- Polled every 4 hours via BullMQ job

### 14.2 Aggregation Strategy (Hybrid)

**Real-time increment** (`apps/engine/src/aggregate.ts`):
After every `RoutingLog.create` with terminal status, fires 5 `INSERT ... ON CONFLICT DO UPDATE` into `routing_daily_aggregates` — one per dimension level (org, rule, path, team, assignee). Uses `IS NOT DISTINCT FROM` for NULL-safe matching on nullable composite columns. Wrapped in `Promise.allSettled` — never blocks routing.

**Important:** PostgreSQL `$14` parameter used across columns of different types requires explicit casts (`$14::double precision`, `$14::integer`) to avoid `inconsistent types deduced for parameter` error.

**Nightly reconciliation** (`apps/engine/src/analytics-queue.ts`):
BullMQ repeatable job at 02:00 UTC. Recomputes yesterday's aggregates from raw routing_logs with full GROUP BY. Computes percentile metrics (p50, p95 duration). 5 separate INSERT queries per dimension level per org.

Manual trigger: `POST /analytics/reconcile` with `{"date":"YYYY-MM-DD"}` to engine.

### 14.3 Conversion Tracking

BullMQ repeatable job every 4 hours:
1. Queries `conversion_tracking WHERE isConverted = false AND createdAt > NOW() - 90 days`
2. Batched SOQL (200-record chunks): `SELECT Id, IsConverted, ConvertedDate, ConvertedOpportunityId FROM Lead WHERE Id IN (...)`
3. For converted leads, fetches Opportunity details (Amount, StageName)
4. Updates conversion_tracking rows

### 14.4 API Routes

All under `apps/web/app/api/analytics/`, authenticated via `getOrgIdFromHeaders()`.

| Route | Purpose |
|-------|---------|
| `GET /api/analytics/overview` | KPI cards + delta vs prior period |
| `GET /api/analytics/volume` | Time-series chart data (granularity + groupBy) |
| `GET /api/analytics/rules` | Per-rule effectiveness with path breakdown |
| `GET /api/analytics/teams` | Per-team fairness + member distribution |
| `GET /api/analytics/conversions` | ROI data, conversion by rule/assignee |
| `POST /api/analytics/conversions/refresh` | Trigger immediate conversion check |

### 14.5 Dashboard UI

Tab layout at `/analytics` with shared filter bar (date range, object type, rule, team, assignee). Four tabs: Overview, Rules, Teams, Conversions.

- **Overview:** 4 KPI cards, stacked area volume chart, top rules table, status donut, speed-to-lead distribution
- **Rules:** Expandable table with per-path breakdown
- **Teams:** Cards with fairness score gauge, per-member horizontal bars
- **Conversions:** 4 KPI cards, speed-to-conversion chart, conversion by rule/assignee tables

---

## 15. Known Gotchas

1. **Next.js 16 uses `proxy.ts` NOT `middleware.ts`** — having both causes a crash.

2. **jsforce cannot be imported in client components** — uses Node `child_process`.

3. **BullMQ requires `maxRetriesPerRequest: null`** on its dedicated ioredis connection.

4. **Engine dev command:** `node --env-file=.env --import tsx --watch` (NOT `tsx watch`).

5. **tsup CJS format for engine** — `format: ['cjs']` + no `"type":"module"` in package.json. ESM format breaks jsforce/node-fetch dynamic requires.

6. **`POSTGRES_PASSWORD` only applies on first `initdb`** — changing it after volume creation requires `ALTER USER` inside the container.

7. **`req.url` inside Docker resolves to container hostname** — always use `process.env.APP_URL` for redirects.

8. **`docker compose restart` does NOT swap the image** — use `docker compose up -d --force-recreate <service>`.

9. **node-ssh has optional native modules** (`cpu-features`, `sshcrypto`) — pnpm skips build scripts, ssh2 uses pure-JS fallbacks. Do NOT use `noExternal: [/.*/]` in CLI tsup config.

10. **Prisma migrations on VPS** — web container's minimal runtime doesn't include `@prisma/engines`. Run SQL directly: `docker compose exec postgres psql -U leadrouting -d leadrouting -f migration.sql`.

11. **Cross-compile Docker images on Apple Silicon** — `docker buildx build --platform linux/amd64` required. ARM64 image on AMD64 VPS crashes with exit code 255.

12. **ENGINE_URL in .env.web must be the public URL** — not Docker-internal `http://engine:3001`. Used by `pushSettings()` to write `Engine_Endpoint__c` in Salesforce.

13. **`@clack/prompts text()` doesn't trim input** — leading spaces in URLs propagate to env files and SFDC config. Apply `.trim()` on all prompted values.

14. **Salesforce Metadata API silently ignores Named Credential endpoint changes** — use `sf data update record` on `Routing_Settings__c` instead.

15. **Docker image tags must match docker-compose.yml** — `docker save` uses the image tag you specify. If compose uses `ghcr.io/atgatzby/lead-routing-web:latest` but you build as `lead-routing-web:latest`, the container keeps running the old GHCR image. Always build with the exact tag from compose.

16. **`onPointerDown` not compiled by Next.js 16 Turbopack** — use `onMouseDown` instead. The pointer event handler silently disappears from the compiled JS chunks.

17. **PostgreSQL raw SQL with shared positional parameters across different types** — `$14` used for `double precision`, `integer`, and `integer` columns simultaneously causes `42P08 inconsistent types`. Fix: explicit casts `$14::double precision`, `$14::integer`.
