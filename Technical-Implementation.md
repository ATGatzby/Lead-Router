# Lead Routing — Technical Implementation

> A self-hosted, Salesforce-native lead routing engine with round-robin assignment, rule-based conditions, and a Next.js management UI — deployed via the `@lead-routing/cli` install wizard.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Repository Structure](#4-repository-structure)
5. [Database Schema](#5-database-schema)
6. [Authentication & Session](#6-authentication--session)
7. [Web Application (Next.js)](#7-web-application-nextjs)
8. [Routing Engine (Fastify)](#8-routing-engine-fastify)
9. [Salesforce Package](#9-salesforce-package)
10. [Redis Usage](#10-redis-usage)
11. [Queue & Retry (BullMQ)](#11-queue--retry-bullmq)
12. [API Reference](#12-api-reference)
13. [Key Algorithms](#13-key-algorithms)
14. [Local Development Setup](#14-local-development-setup)
15. [CLI — Self-Hosted Installer (`@lead-routing/cli`)](#15-cli--self-hosted-installer-lead-routingcli)
16. [Docker Images](#16-docker-images)
17. [Known Issues & Fixes](#17-known-issues--fixes)
18. [Admin Portal & Subscription Tiers](#18-admin-portal--subscription-tiers)

---

## 1. System Overview

Lead Routing automatically assigns incoming Salesforce records (Leads, Contacts, Accounts) to sales reps or queues based on configurable rules. When a record is created or updated in Salesforce:

1. A Salesforce Apex trigger fires and makes an async HTTPS callout to the routing engine
2. The engine validates the HMAC signature, evaluates active routing rules against the record's fields
3. The first matching rule's assignee is resolved (individual user, round-robin team, or SFDC queue)
4. The engine updates the record's `OwnerId` in Salesforce via the jsforce API
5. The outcome is logged to the database and optionally sent to a notification webhook

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Salesforce Org                                                  │
│                                                                  │
│  LeadTrigger (after insert/update)                              │
│       ↓ @future(callout=true)                                   │
│  RoutingEngineCallout → HMAC sign → POST /route                 │
│       ↑  (endpoint read from Routing_Settings__c.Engine_Endpoint__c) │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS (via ngrok in dev, direct in prod)
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│  Routing Engine (Fastify, port 3001)                            │
│                                                                  │
│  POST /route                                                     │
│    1. Validate X-Signature-256 header (HMAC-SHA256)             │
│    2. Idempotency check (Redis SET NX EX 3600)                  │
│    3. Load rules from in-memory cache                           │
│    4. Evaluate conditions (field comparisons)                   │
│    5. Resolve assignee (user / round-robin / queue)             │
│    6. Update OwnerId in Salesforce (jsforce)                    │
│    7. Log result to PostgreSQL                                   │
│    8. Fire notification webhook (optional, async)               │
│                                                                  │
│  In-memory Rule Cache ←── Redis pub/sub ←── Web App mutations  │
│  BullMQ Worker (retry failed SFDC updates)                      │
└───────────────────────┬─────────────────────────────────────────┘
                        │
              ┌─────────┴──────────┐
              ↓                    ↓
┌─────────────────────┐  ┌──────────────────────┐
│  PostgreSQL (DB)    │  │  Redis               │
│  - organizations    │  │  - Round-robin ptrs  │
│  - users            │  │  - Idempotency keys  │
│  - routing_rules    │  │  - rules:invalidate  │
│  - routing_logs     │  │    pub/sub channel   │
│  - audit_logs       │  │  - BullMQ queues     │
│  - ...              │  └──────────────────────┘
└─────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Web App (Next.js 16, port 3000)                                │
│                                                                  │
│  - Email/password login; invite-based registration              │
│  - SFDC OAuth (CRM connect step in onboarding)                  │
│  - License Users management (sync from SFDC)                   │
│  - Round-Robin Teams CRUD                                       │
│  - Routing Rules builder (condition groups, drag-to-reorder)   │
│  - Routing History, Stats, Failed, Audit Log                   │
│  - Settings (General: Salesforce sync, Webhooks: routing webhook)│
│  - Onboarding checklist                                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Monorepo | Turborepo + pnpm workspaces | turbo ^2.8 |
| Web app | Next.js (App Router) | 16.1.6 |
| UI framework | React | 19.2.3 |
| Styling | Tailwind CSS v4 | ^4 |
| UI components | shadcn/ui (new-york style) + Radix UI | radix-ui ^1.4.3 |
| Database | PostgreSQL | 16 (Docker) |
| ORM | Prisma | workspace package `@lead-routing/db` |
| SFDC client | jsforce v2 | workspace package `@lead-routing/sfdc` |
| Auth | iron-session | ^8.0.4 |
| Server state | TanStack Query | v5 |
| Routing engine | Fastify | v5 |
| Queue | BullMQ | v5 |
| Cache/pub-sub | Redis via ioredis | ^5.6.1 |
| Language | TypeScript | ^5.9 |
| Runtime | Node.js | 24.x |

---

## 4. Repository Structure

```
lead-routing/
├── apps/
│   ├── web/                        # Next.js 16 management UI
│   │   ├── app/
│   │   │   ├── (dashboard)/        # Route group — no URL prefix
│   │   │   │   ├── layout.tsx      # Sidebar + topbar layout
│   │   │   │   ├── dashboard/      # → /dashboard
│   │   │   │   ├── license-users/  # → /license-users
│   │   │   │   ├── round-robins/   # → /round-robins
│   │   │   │   ├── routing-rules/  # → /routing-rules
│   │   │   │   ├── history/        # → /history (+ stats, failed, audit)
│   │   │   │   ├── settings/       # → /settings (+ billing, notifications)
│   │   │   │   └── error.tsx       # Next.js error boundary
│   │   │   ├── (auth)/
│   │   │   │   ├── login/          # → /login (email/password form)
│   │   │   │   └── register/       # → /register?token=... (invite registration)
│   │   │   ├── api/                # Route handlers
│   │   │   └── providers.tsx       # QueryClientProvider
│   │   ├── components/
│   │   │   ├── layout/             # sidebar.tsx, topbar.tsx
│   │   │   ├── condition-builder/  # Rule condition UI (5 files)
│   │   │   ├── rule-form/          # RuleForm.tsx, AssigneeSelect.tsx
│   │   │   ├── upgrade-modal.tsx   # INR pricing modal
│   │   │   ├── onboarding-checklist.tsx
│   │   │   └── ui/                 # shadcn components
│   │   ├── lib/
│   │   │   ├── auth.ts             # getOrgIdFromHeaders, getActorFromHeaders
│   │   │   ├── session.ts          # SessionData type, iron-session options
│   │   │   ├── redis.ts            # ioredis singleton (default export)
│   │   │   ├── operators.ts        # Browser-safe copy of field operators
│   │   │   ├── evaluator.ts        # Rule evaluator (for Test Rule feature)
│   │   │   ├── invalidate-rules-cache.ts  # Publishes to rules:invalidate
│   │   │   └── routing-queue.ts    # BullMQ producer
│   │   └── proxy.ts                # Next.js 16 middleware (auth + header injection)
│   │
│   └── engine/                     # Fastify routing engine
│       └── src/
│           ├── server.ts           # Fastify server, startup
│           ├── routes/
│           │   └── route.ts        # POST /route webhook handler
│           ├── router.ts           # Orchestration: rules → eval → assign → log → SFDC
│           ├── evaluator.ts        # Boolean rule evaluation
│           ├── cache.ts            # In-memory rule cache + Redis pub/sub
│           ├── idempotency.ts      # Redis SET NX dedup
│           ├── round-robin.ts      # Lua atomic pointer
│           ├── sfdc.ts             # jsforce connection pool
│           ├── queue.ts            # BullMQ queue + worker + DLQ
│           ├── redis.ts            # ioredis singleton (named export)
│           ├── webhook.ts          # Fire-and-forget notification webhook
│           └── middleware/
│               └── validate-signature.ts  # HMAC-SHA256 verification
│
├── packages/
│   ├── db/                         # Prisma client (@lead-routing/db)
│   │   ├── prisma/schema.prisma
│   │   └── src/index.ts            # exports { prisma }
│   └── sfdc/                       # jsforce helpers (@lead-routing/sfdc)
│       └── src/
│           ├── client.ts           # createConnection (jsforce default import)
│           ├── update-owner.ts     # updateOwner(conn, objectType, recordId, ownerId)
│           ├── schema.ts           # syncFieldSchema
│           ├── queues.ts           # syncQueues
│           ├── operators.ts        # getOperatorsForType, NO_VALUE_OPERATORS
│           ├── settings.ts         # pushSettings (writes Webhook_Secret__c + Engine_Endpoint__c + App_Url__c to Routing_Settings__c; syncs Named Credential + Remote Site Setting via Metadata API)
│           └── index.ts            # re-exports
│
├── sfdc-package/                   # Salesforce DX metadata project
│   └── force-app/main/default/
│       ├── classes/                # OnboardingController.cls, RoutingEngineCallout.cls, etc.
│       ├── triggers/               # LeadTrigger, ContactTrigger, AccountTrigger
│       ├── objects/Routing_Settings__c/fields/
│       │   ├── App_Url__c.field-meta.xml          # Web app URL (read by LWC + Apex)
│       │   └── Engine_Endpoint__c.field-meta.xml  # Engine URL
│       ├── lwc/onboardingWizard/   # Post-install onboarding LWC (URL-dynamic via connectedCallback)
│       ├── namedCredentials/       # RoutingEngine — endpoint placeholder, patched by CLI
│       ├── connectedApps/          # LeadRoutingApp
│       └── remoteSiteSettings/     # LeadRouterEngine — URL placeholder, patched by CLI
│
├── load-test/
│   └── routing-load-test.js        # k6, 500 VUs, p95 < 5s threshold
│
└── plans/                          # Phase planning documents (Phase1–Phase8)
```

---

## 5. Database Schema

**14 tables** managed by Prisma (PostgreSQL). All IDs use `cuid()`.

### organizations
| Column | Type | Notes |
|---|---|---|
| id | String PK | cuid |
| sfdcOrgId | String? UNIQUE | 18-char Salesforce Org ID (`00D...`); **nullable** — set after CRM connect in onboarding |
| sfdcInstanceUrl | String? | e.g. `https://myorg.salesforce.com`; nullable |
| oauthAccessToken | String? | SFDC OAuth access token; nullable |
| oauthRefreshToken | String? | SFDC OAuth refresh token; nullable |
| webhookSecret | String | HMAC-SHA256 secret — must match `Webhook_Secret__c` in SFDC Custom Setting |
| plan | Plan enum | FREE (default) or PAID — drives seat and quota limits |
| isActive | Boolean | false = org suspended; engine returns 403, web redirects to /suspended |
| seatsPurchased | Int | Seeded to 9999 by CLI init (self-hosted — cap never hit); overridable via admin portal |
| seatsUsed | Int | Incremented on license grant |
| routingQuotaUsed | Int | Running count of successful routings this month |
| quotaResetAt | DateTime | Reset lazily when engine sees this timestamp in the past |
| onboardingDone | Boolean | Set true by SFDC package post-install |
| notificationWebhookUrl | String? | Optional WhatsApp/Slack webhook |

### users
| Column | Type | Notes |
|---|---|---|
| sfdcUserId | String | SFDC User ID (`005...`) |
| isLicensed | Boolean | Only licensed users can receive routed leads |
| isActive | Boolean | False if user no longer exists in SFDC |
| lastRoutedAt | DateTime? | Updated on each assignment |

### round_robin_teams + team_members
- Teams are named groups of licensed users
- `pointerIndex` in DB is informational; **Redis is authoritative** for the live pointer
- Members have `status` (ACTIVE/PAUSED), `weight` (future weighted RR), `assignmentCount`

### routing_rules + rule_conditions
- Rules have `priority` (evaluated ascending — lower = higher priority)
- `triggerEvent`: INSERT, UPDATE, or BOTH
- `assignmentType`: USER, ROUND_ROBIN, or QUEUE
- Conditions: same `groupId` = AND logic; different `groupId` = OR logic
- `isDryRun`: log the match but don't update SFDC

### routing_logs
- Created for every processed event (SUCCESS, FAILED, UNMATCHED, RETRY)
- `sfdcRecordId` = Salesforce record ID (`00Q...`, `003...`, etc.)
- `retryCount` incremented on BullMQ retry attempts
- `dismissed` = admin acknowledged the failure
- `recordSnapshot` (Json?) = full SFDC field payload at time of routing; displayed in the History UI as a click-to-open popover on the Record ID column

### app_users
| Column | Type | Notes |
|---|---|---|
| id | String PK | cuid |
| orgId | String FK | references organizations.id |
| email | String | Login email |
| name | String | Display name |
| passwordHash | String | PBKDF2: `salt:hash` (16-byte hex salt, 310000 iterations, sha256) |
| role | String | `ADMIN` \| `MEMBER` (default: ADMIN) |
| isActive | Boolean | false = account disabled |
| createdAt / updatedAt | DateTime | |

Unique constraint: `(orgId, email)`. Separate from `User` (which are SFDC routing recipients).

### invites
| Column | Type | Notes |
|---|---|---|
| id | String PK | cuid |
| orgId | String FK | references organizations.id |
| email | String | Invited email address |
| token | String UNIQUE | 48-char hex (`crypto.randomBytes(24).toString("hex")`) |
| expiresAt | DateTime | 72 hours from creation |
| acceptedAt | DateTime? | Null until registration completes |
| createdAt | DateTime | |

### audit_logs
- Every mutation in the web app creates an audit log entry
- `beforeState` / `afterState` stored as JSON for diff display

### field_schemas
- Synced from SFDC on demand via `POST /api/fields/sync`
- `fieldApiName` is Pascal-case (e.g. `FirstName`, `LeadSource`, `AnnualRevenue`)
- `fieldType`: TEXT | NUMBER | DATE | DATETIME | BOOLEAN | PICKLIST | MULTI_PICKLIST | LOOKUP

### Enums
```
SfdcObjectType:   LEAD | CONTACT | ACCOUNT
TriggerEvent:     INSERT | UPDATE | BOTH
RuleStatus:       ACTIVE | INACTIVE
AssignmentType:   USER | ROUND_ROBIN | QUEUE
TeamMemberStatus: ACTIVE | PAUSED
RoutingStatus:    SUCCESS | FAILED | UNMATCHED | RETRY
Plan:             FREE | PAID
```

### Tier Limits (`packages/db/src/plan-limits.ts`)
| Plan | Seats | Routing Leads/Month |
|------|-------|---------------------|
| FREE | 5 | 100 |
| PAID | 20 | 1,000 |

Exported as `PLAN_LIMITS` and `getPlanLimits(plan)` from `@lead-routing/db`. Used by both the engine and web app.

---

## 6. Authentication & Session

### Login Strategy (Email/Password + Invite Flow)

Authentication is decoupled from Salesforce CRM connection:

```
Admin → POST /api/admin/orgs (creates org, generates invite token, sends email via Resend)
  → Customer receives email with: ${APP_URL}/register?token=<48-char-hex>

Customer → GET /register?token=... → page calls GET /api/auth/register?token=...
  → Validate Invite (not expired, not accepted)
  → Customer fills name + password → POST /api/auth/register
  → Creates AppUser record, marks invite.acceptedAt, sets iron-session
  → Redirect to /dashboard

Customer → GET /login → email + password form → POST /api/auth/login
  → Look up AppUser by email, verify PBKDF2 password hash
  → Set iron-session → Redirect to /dashboard

Onboarding → Click "Connect Salesforce" → GET /api/auth/sfdc/login
  → Redirect to SFDC OAuth (requires existing session)
  → Callback: GET /api/auth/sfdc/callback
  → Update org.sfdcOrgId / sfdcInstanceUrl / oauthAccessToken / oauthRefreshToken
  → Redirect to /dashboard?crm_connected=1
```

### Password Hashing
- Algorithm: PBKDF2 with SHA-256, 310,000 iterations, 32-byte key
- Stored as `salt:hash` where salt = 16-byte hex (`crypto.randomBytes(16).toString("hex")`)
- Implemented in `apps/web/lib/crypto.ts`: `hashPassword()` / `verifyPassword()`
- Uses `crypto.timingSafeEqual` to prevent timing attacks

### iron-session Cookie
- Cookie name: `lr_session`
- Encrypted with `SESSION_SECRET` env var
- Contains: `{ orgId, appUserId, userEmail, userName, role }`
- `appUserId` = `AppUser.id` (cuid) — **not** a SFDC user ID

### Next.js 16 Middleware (`proxy.ts`)
Next.js 16 uses `proxy.ts` (not `middleware.ts`). Located at `apps/web/proxy.ts`.

Public paths (no auth required): `/login`, `/register`, `/api/auth/*`, `/api/setup/*`, `/suspended`, `/admin` paths (handled by admin guard), static assets.

On every protected request:
1. **Admin guard**: If path starts with `/admin` or `/api/admin/`, validates `admin_token` cookie via HMAC. Redirects to `/admin/login` if invalid.
2. Decrypts the iron-session cookie
3. **Suspended org check**: If Redis key `org:suspended:{orgId}` is set, redirects to `/suspended` (API returns 403)
4. Injects three headers for downstream route handlers:
   - `x-org-id` → `session.orgId`
   - `x-user-id` → `session.appUserId`
   - `x-user-name` → `session.userName`

Route handlers read these via:
```typescript
// apps/web/lib/auth.ts
export async function getOrgIdFromHeaders(): Promise<string>
export async function getActorFromHeaders(): Promise<{ orgId, userId, userName }>
```

**Important**: Both functions are `async` and take **no arguments** (they call Next.js `headers()`).

---

## 7. Web Application (Next.js)

### Module: License Users (`/license-users`)

- **Sync**: `POST /api/users` — calls `syncFieldSchema` against SFDC, upserts users from `SELECT Id, Name, Email, Profile.Name FROM User WHERE IsActive = true`
- **License toggle**: `POST /api/users/[id]/license` / `de-license` — API-level seat cap check still exists but is never triggered (`seatsPurchased = 9999`)
- **Bulk license**: `POST /api/users/bulk-license`
- Seat usage tracked on `Organization.seatsUsed`
- Seat counter pill and "Seat limit reached" upgrade dialog removed from UI (self-hosted cleanup)

### Module: Round-Robin Teams (`/round-robins`)

- CRUD on `RoundRobinTeam`
- Add/remove members, ACTIVE/PAUSED toggle per member
- `POST /api/teams/[id]/reset-pointer` — resets Redis key `rr:{orgId}:{teamId}:pointer` to 0
- Delete guard: 409 if team is referenced by any active rule

### Module: Routing Rules (`/routing-rules`)

- Drag-to-reorder (reorders `priority` field)
- Clone rule: `POST /api/rules/[id]/clone`
- Status toggle: `PATCH /api/rules/[id]/status`
- **Test Rule**: `POST /api/rules/[id]/test` — evaluates a pasted JSON payload against the saved rule conditions using the web-side evaluator (`apps/web/lib/evaluator.ts`), no SFDC changes
- Rule mutations publish to Redis `rules:invalidate` channel so the engine reloads its cache

#### New Rule — Creation Mode Fork

`apps/web/app/(dashboard)/routing-rules/new/page.tsx` has a `mode: "choose" | "manual" | "ai"` state:

- **`choose`** (default): A two-card choice screen. "Create Manually" → `mode = "manual"`. "AI Routing Rule" (violet, Beta badge) → `mode = "ai"`.
- **`manual`**: Renders the existing `<RuleForm>` — identical to the previous flow.
- **`ai`**: Placeholder card ("Coming Soon") with a "Create Manually Instead" fallback. Will be replaced with the full AI generator (see `plans/AIRule-Generator.md`) in a future phase.

### Condition Builder
- 5 React components in `apps/web/components/condition-builder/`
- Conditions within a group = AND; groups = OR
- Field operators sourced from `apps/web/lib/operators.ts` (browser-safe — does **not** import `@lead-routing/sfdc` which pulls in Node.js `child_process`)

### Module: History & Audit (`/history`)

| Sub-page | Route | Description |
|---|---|---|
| History | `/history` | Paginated routing log with filters |
| Stats | `/history/stats` | Per-rep assignment counts |
| Failed | `/history/failed` | Failed routings, retry/dismiss actions |
| Audit | `/history/audit` | Audit log with JSON diff viewer |

- CSV export: `GET /api/routing-logs/export`
- Retry failed: `POST /api/routing-logs/[id]/retry` — enqueues job to BullMQ
- Dismiss: `POST /api/routing-logs/[id]/dismiss`
- Record ID column shows a `⧼⧽` icon (Braces) when `recordSnapshot` is present; clicking opens a Popover listing all non-null SFDC field key/value pairs captured at routing time

### Module: Settings

Settings sidebar has two tabs:

- **General** (`/settings`): Salesforce webhook-secret sync button. Removed: Plan & Seats section, Routing Quota section, Upgrade button.
- **Webhooks** (`/settings/notifications`): Post-routing webhook URL (engine fires on every successful routing) + WhatsApp Cloud API template reference. Formerly labelled "Notifications" — renamed to "Webhooks" for clarity.

Removed in self-hosted cleanup: `/settings/billing` (GST billing address form), `FeedbackButton` floating widget, `QuotaBanner` top-of-dashboard banner, `UpgradeModal` pricing dialog.

### Admin Org Creation (`POST /api/admin/orgs`)
- Required: `inviteEmail` (valid email)
- Optional: `entityName`, `plan` (FREE/PAID), `seatsPurchased`
- **No longer requires** SFDC Org ID or Instance URL (set later via onboarding CRM connect)
- Auto-generates `webhookSecret` (64-char hex) and invite token (48-char hex)
- Creates `Invite` record with 72h expiry
- Sends registration email via Resend: `${APP_URL}/register?token=<token>`
- Returns `{ org, inviteLink }` — admin can copy link for manual sharing

### Onboarding Checklist
Dashboard page (`/dashboard`) shows a "Getting Started" checklist that auto-hides when all steps complete:
1. **Connect Salesforce org** — done when `org.sfdcOrgId != null`; click links to `/api/auth/sfdc/login`
2. License at least one user
3. Create a round-robin team
4. Create an active routing rule

`GET /api/onboarding/status` returns the same 4 items (used by the sidebar widget). Step 1 `done` is based on `org.sfdcOrgId !== null`.

---

## 8. Routing Engine (Fastify)

### Server Startup (`server.ts`)
```
1. Register raw body plugin (needed for HMAC validation)
2. Register POST /route handler
3. Register GET /health handler
4. loadAllRules() — load all ACTIVE rules from DB into in-memory cache
5. startCacheInvalidationListener() — subscribe to Redis rules:invalidate
6. Listen on port 3001
```

### Request Lifecycle (`POST /route`)

```
1. Parse body — require: sfdcOrgId, objectType, eventType, recordId, timestamp, fields
   → 400 if any missing

2. Look up org by sfdcOrgId (18-char Salesforce Org ID)
   → 401 "Unknown org" if not found

3. Read X-Signature-256 header (SFDC sends: "sha256=<hex>")
   → 401 if missing

4. Validate HMAC-SHA256: crypto.timingSafeEqual(expected, received)
   → 401 "Invalid signature" if mismatch

4.5a. isActive gate: if org.isActive === false → 403 "Organization is suspended"

4.5b. Lazy quota reset: if org.quotaResetAt < now → reset routingQuotaUsed=0, quotaResetAt=start of next month (UTC)

4.5c. Quota gate: if quotaUsed >= PLAN_LIMITS[plan].routingLeadsPerMonth → 429 { error, plan, limit, used }

5. Claim idempotency key: SET idem:{orgId}:{recordId}:{eventType}:{timestamp} NX EX 3600
   → 200 { status: "duplicate" } if already processed

6. Call routeRecord(payload)
   → 200 { status: "routed"|"unmatched"|"dry_run", latencyMs }

6.5. If result === "routed": increment routingQuotaUsed by 1 (atomic DB update)

7. On unhandled error → 500
```

### Rule Evaluation (`evaluator.ts`)

```typescript
evaluateRule(record, conditions):
  - Zero conditions → always matches (catch-all)
  - Group conditions by groupId
  - Within a group: ALL conditions must pass (AND)
  - Between groups: ANY group passing = match (OR)

evalCondition(record, condition):
  // Case-insensitive field name lookup (SFDC sends lowercase, DB stores Pascal-case)
  raw = record[fieldName] ?? record[fieldName.toLowerCase()]

  Operators:
  - is_blank / is_not_blank
  - is_true / is_false
  - equals / not_equals (string comparison)
  - contains / not_contains (case-insensitive substring)
  - starts_with (case-insensitive)
  - gt / lt / gte / lte (numeric)
  - before / after (date)
  - within_last (N days)
  - includes / excludes (semicolon-separated multi-picklist)
```

### Round-Robin Assignment (`round-robin.ts`)

Uses a **Lua script** executed atomically in Redis:

```lua
local key   = KEYS[1]          -- rr:{orgId}:{teamId}:pointer
local count = tonumber(ARGV[1]) -- number of active members
local current = redis.call('INCR', key)
return (current - 1) % count
```

This ensures even 500 concurrent routing events each get a unique, distinct slot. The pointer key persists across restarts; it can be reset via `POST /api/teams/[id]/reset-pointer`.

### In-Memory Rule Cache (`cache.ts`)

- All `ACTIVE` rules loaded from DB at startup
- Stored as `Map<"orgId:objectType", CachedRule[]>` sorted by `priority ASC`
- **Invalidation**: when any rule is mutated in the web app, `invalidateRulesCache(orgId, objectType)` publishes `{ orgId, objectType }` to the Redis channel `rules:invalidate`
- Engine's subscriber calls `loadRulesFromDB(orgId, objectType)` and refreshes the map entry
- Uses a **dedicated Redis connection** for the subscriber (pub/sub connections cannot be reused for commands)

### SFDC Connection Pool (`sfdc.ts`)

- In-process `Map<orgId, SfdcConnection>` — one jsforce connection per org
- jsforce handles token refresh automatically
- `updateOwner(conn, "Lead", recordId, sfdcUserId)` patches `OwnerId` via REST API

### Retry Queue (`queue.ts`)

BullMQ queue named `"routing-retries"`:
- **3 attempts**, exponential backoff: 2s → 8s → 32s
- On all attempts exhausted → moved to Dead Letter Queue (DLQ): `routing-retries:failed`
- `RoutingLog.status` stays as `RETRY` until success, then updated to `SUCCESS`
- Worker co-located in engine process

---

## 9. Salesforce Package

**Project path**: `sfdc-package/`
**Namespace**: `lrt`
**Automated deploy**: `lead-routing sfdc deploy` (see §15) — authenticates, patches XML, and runs `sf project deploy start`.
**Manual deploy command**:
```bash
sf project deploy start \
  --target-org lead-router \
  --metadata ApexClass \
  --metadata ApexTrigger \
  --metadata CustomObject \
  --metadata CustomField \
  --metadata NamedCredential \
  --metadata LightningComponentBundle \
  --metadata RemoteSiteSettings
```
> Note: Exclude `--metadata ConnectedApp` — use the org's own Connected App.

### Apex Triggers

Three triggers covering all supported objects, identical logic:

```apex
trigger LeadTrigger on Lead (after insert, after update) {
    Routing_Settings__c settings = Routing_Settings__c.getOrgDefaults();
    if (!settings.Lead_Routing_Enabled__c) return;

    if (Trigger.isInsert && settings.Lead_Insert_Enabled__c)
        RoutingEngineCallout.sendAsync('Lead', Trigger.newMap.keySet(), 'INSERT');

    if (Trigger.isUpdate && settings.Lead_Update_Enabled__c)
        RoutingEngineCallout.sendAsync('Lead', Trigger.newMap.keySet(), 'UPDATE');
}
```

### RoutingEngineCallout (Apex)

- `@future(callout=true)` — runs outside trigger transaction
- Queries all fields for each record dynamically (Schema.getGlobalDescribe)
- Calls `RoutingPayloadBuilder.build()` to construct JSON payload
- Signs payload with HMAC-SHA256 using `Webhook_Secret__c`
- Reads `Engine_Endpoint__c` from `Routing_Settings__c` and posts to `{engineEndpoint}/route` directly (no Named Credential URL dependency)
- Sends header `X-Signature-256: sha256=<hex>`
- Any non-200/202 response → inserts `Routing_Error_Log__c` record

### Payload Schema (JSON sent from Apex to Engine)

```json
{
  "objectType": "LEAD",
  "eventType": "INSERT",
  "recordId": "00QgL00000AvOSsUAN",
  "sfdcOrgId": "00DgL00000LQhSVUA1",
  "timestamp": "2026-02-24T17:55:14Z",
  "fields": {
    "firstname": "Amit",
    "lastname": "Shah",
    "company": "Acme Corp",
    "leadsource": "Web",
    "status": "Open - Not Contacted",
    ...all other Lead fields (lowercase keys)...
  }
}
```

> **Important**: SFDC's `JSON.serialize()` lowercases all field names. The engine evaluator handles this with a case-insensitive fallback: `record[fieldName] ?? record[fieldName.toLowerCase()]`.

### Custom Setting: Routing_Settings__c (Hierarchy)

| Field | API Name | Type | Purpose |
|---|---|---|---|
| Routing Enabled | Lead_Routing_Enabled__c | Checkbox | Master on/off switch for Lead routing |
| Insert Enabled | Lead_Insert_Enabled__c | Checkbox | Route on Lead creation |
| Update Enabled | Lead_Update_Enabled__c | Checkbox | Route on Lead updates (⚠️ can loop — see §17) |
| Webhook Secret | Webhook_Secret__c | Text(255) | Must match `Organization.webhookSecret` in DB |
| App URL | App_Url__c | Text(255) | Web app base URL — read by `OnboardingController` and `onboardingWizard` LWC; written by `lead-routing sfdc deploy` and `pushSettings()` |
| Engine Endpoint | Engine_Endpoint__c | Text(255) | Routing engine public URL — written by `lead-routing sfdc deploy`; read at callout time by `RoutingEngineCallout` and `OnboardingController.sendTestEvent()` |

Configure via: Setup → Custom Settings → Routing Settings → Manage → **New** (Org Default)

### Custom Object: Routing_Error_Log__c

Captures all non-200 responses from the routing engine for debugging:

| Field | Description |
|---|---|
| Name | Auto-number (ERR-0000001) |
| Payload__c | Full JSON payload sent to engine (max 131,072 chars) |
| Status_Code__c | HTTP response status code |
| Response_Body__c | Engine response body |
| Created_At__c | Datetime of callout |

### Named Credential: RoutingEngine

```xml
<endpoint>https://placeholder.example.com</endpoint>  <!-- patched by lead-routing sfdc deploy -->
<principalType>Anonymous</principalType>
<protocol>NoAuthentication</protocol>
```

**Note:** The Named Credential is no longer used for HTTP callouts. `RoutingEngineCallout` and `OnboardingController.sendTestEvent()` now read the engine URL directly from `Routing_Settings__c.Engine_Endpoint__c` (set by `lead-routing sfdc deploy` via `sf data update record`). This avoids the Salesforce Metadata API reliability issue where `<endpoint>` changes in Named Credential XML were silently ignored on re-deploy.

The Named Credential XML is still deployed (and its `<endpoint>` patched) for completeness, but it is not used in the callout path.

### Remote Site Settings

Two Remote Site Settings are deployed in the sfdc-package:

| Setting | File | URL source | Purpose |
|---|---|---|---|
| `LeadRouterEngine` | `remoteSiteSettings/LeadRouterEngine.remoteSite-meta.xml` | `config.engineUrl` | Allows Apex Named Credential callouts to the routing engine |
| `LeadRouterApp` | `remoteSiteSettings/LeadRouterApp.remoteSite-meta.xml` | `config.appUrl` | Allows `OnboardingController.checkConnectionStatus()` to call `{appUrl}/api/setup/status` |

Both URLs are set to `https://placeholder.example.com` in the committed XML and patched to the customer's actual URLs by `lead-routing sfdc deploy` before running `sf project deploy start`. Without `LeadRouterApp`, Salesforce throws `CalloutException: Unauthorized endpoint` when the LWC polls for connection status, causing the wizard to spin forever on Step 1.

### LWC: onboardingWizard

Post-install wizard that guides Salesforce admins through 4 steps:
1. **Connect** — Opens OAuth popup to `{appUrl}/api/auth/sfdc/login`; polls `OnboardingController.checkConnectionStatus()` (which calls `{appUrl}/api/setup/status?sfdcOrgId=...`) until `connected: true` — requires `LeadRouterApp` Remote Site Setting
2. **Configure triggers** — Toggle Lead/Contact/Account routing on/off; calls `OnboardingController.saveRoutingSettings()`
3. **Sync field schema** — Calls `OnboardingController.syncFieldSchema()` for each enabled object type
4. **Activate** — Calls `OnboardingController.markOnboardingDone()`

**URL resolution**: The LWC no longer hardcodes `https://app.leadrouter.io`. In `connectedCallback()`, it calls `getAppUrl()` and `getOrgId()` Apex methods which read `Routing_Settings__c.App_Url__c` and `UserInfo.getOrganizationId()`. If `App_Url__c` is blank, an inline error is shown with instructions to run `lead-routing sfdc deploy`.

**OnboardingController.cls** key methods:
- `getAppUrl()` — returns `Routing_Settings__c.App_Url__c` (AuraEnabled)
- `getOrgId()` — returns `UserInfo.getOrganizationId()` (AuraEnabled)
- `getAppBaseUrl()` — private; reads `App_Url__c`, throws `AuraHandledException` if blank
- All HTTP callouts use `getAppBaseUrl()` — no hardcoded URLs

---

## 10. Redis Usage

| Key Pattern | Type | TTL | Purpose |
|---|---|---|---|
| `rr:{orgId}:{teamId}:pointer` | String | none | Round-robin pointer (atomic INCR via Lua) |
| `idem:{orgId}:{recordId}:{eventType}:{timestamp}` | String | 3600s | Idempotency dedup |
| `rules:invalidate` | Pub/sub channel | — | Cache invalidation signal from web app to engine |
| `bull:routing-retries:*` | BullMQ keys | varies | Retry job queue |
| `org:suspended:{orgId}` | String | none | Set to `"1"` when admin suspends an org; deleted on activation |

Two ioredis instances in the engine:
1. **Command connection** (`redis.ts`) — for round-robin and idempotency
2. **Subscriber connection** (created in `cache.ts`) — dedicated to pub/sub (cannot be shared)

Web app has its own ioredis instance (`apps/web/lib/redis.ts`, `lazyConnect: true`, **default export**).

---

## 11. Queue & Retry (BullMQ)

Queue name: `"routing-retries"`

### Job Data Structure
```typescript
interface RetryJobData {
  logId: string;     // RoutingLog.id to update
  orgId: string;
  recordId: string;  // SFDC record ID
  objectType: string; // Pascal-case: "Lead" | "Contact" | "Account"
  ownerId: string;   // SFDC User or Queue ID to set as OwnerId
}
```

### Retry Policy
- **3 total attempts**
- **Exponential backoff**: 2s → 8s → 32s
- On success: `RoutingLog.status` → `SUCCESS`
- On all attempts exhausted: job moves to DLQ (`routing-retries:failed`), `RoutingLog.status` stays `RETRY`
- Admin can manually retry from the `/history/failed` page (re-enqueues via `POST /api/routing-logs/[id]/retry`)

### BullMQ Redis Connection
BullMQ requires `maxRetriesPerRequest: null` on its ioredis connection — this is different from the standard connection and must be set explicitly.

---

## 12. API Reference

All web app API routes are under `apps/web/app/api/`. Auth headers are injected by `proxy.ts`.

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | Email + password login — returns `{ ok: true }` |
| GET | `/api/auth/register` | Validate invite token → returns `{ email, orgName }` |
| POST | `/api/auth/register` | Complete registration with invite token + name + password |
| GET | `/api/auth/sfdc/login` | Redirect to Salesforce OAuth (requires existing session) |
| GET | `/api/auth/sfdc/callback` | OAuth callback — updates org SFDC fields, no new session |
| POST | `/api/auth/logout` | Clears iron-session cookie |
| GET | `/api/auth/me` | Returns current session user |

### Users
| Method | Path | Description |
|---|---|---|
| GET | `/api/users` | List licensed users |
| POST | `/api/users` | Sync users from SFDC |
| POST | `/api/users/[id]/license` | Grant license (enforces seat cap) |
| POST | `/api/users/[id]/de-license` | Revoke license |
| POST | `/api/users/bulk-license` | Bulk license toggle |
| GET | `/api/users/stats` | Assignment counts per user |

### Teams
| Method | Path | Description |
|---|---|---|
| GET | `/api/teams` | List teams |
| POST | `/api/teams` | Create team |
| GET | `/api/teams/[id]` | Team detail with members |
| PUT | `/api/teams/[id]` | Update team name/description |
| DELETE | `/api/teams/[id]` | Delete (409 if referenced by active rule) |
| POST | `/api/teams/[id]/members` | Add member |
| PATCH | `/api/teams/[id]/members/[userId]` | Toggle member status |
| DELETE | `/api/teams/[id]/members/[userId]` | Remove member |
| POST | `/api/teams/[id]/reset-pointer` | Reset Redis round-robin pointer to 0 |

### Routing Rules
| Method | Path | Description |
|---|---|---|
| GET | `/api/rules` | List rules (by objectType) |
| POST | `/api/rules` | Create rule (+ publishes cache invalidation) |
| GET | `/api/rules/[id]` | Rule detail with conditions |
| PUT | `/api/rules/[id]` | Update rule |
| DELETE | `/api/rules/[id]` | Delete rule |
| PATCH | `/api/rules/[id]/status` | Toggle ACTIVE/INACTIVE |
| POST | `/api/rules/[id]/clone` | Clone rule |
| POST | `/api/rules/[id]/test` | Evaluate rule against pasted JSON (no SFDC changes) |
| PUT | `/api/rules/reorder` | Bulk reorder priorities |

### Fields & Queues
| Method | Path | Description |
|---|---|---|
| GET | `/api/fields` | List synced field schemas |
| POST | `/api/fields/sync` | Sync field schema from SFDC — authenticated via `X-Sfdc-Org-Id` header (Apex server-to-server callout, no browser session) |
| GET | `/api/queues` | List synced SFDC queues |
| POST | `/api/queues/sync` | Sync queues from SFDC |

### Routing Logs
| Method | Path | Description |
|---|---|---|
| GET | `/api/routing-logs` | Paginated log (filters: status, objectType, date range) |
| GET | `/api/routing-logs/stats` | Per-assignee stats |
| GET | `/api/routing-logs/failed` | Failed + RETRY entries |
| GET | `/api/routing-logs/export` | CSV export |
| POST | `/api/routing-logs/[id]/retry` | Re-enqueue failed job |
| POST | `/api/routing-logs/[id]/dismiss` | Mark as dismissed |

### Audit Logs
| Method | Path | Description |
|---|---|---|
| GET | `/api/audit-logs` | Paginated audit log with JSON diff |

### Settings
| Method | Path | Description |
|---|---|---|
| GET/PUT | `/api/settings/billing` | GST billing info + quota data (plan, routingQuotaUsed, quotaLimit, quotaResetAt) |
| GET/PUT | `/api/settings/notifications` | Notification webhook URL |

### Admin Portal (requires `admin_token` cookie)
| Method | Path | Description |
|---|---|---|
| POST | `/api/admin/auth/login` | Validate ADMIN_SECRET, set `admin_token` cookie (8h HMAC) |
| POST | `/api/admin/auth/logout` | Clear `admin_token` cookie |
| GET | `/api/admin/orgs` | List all orgs with plan, seats, quota, CRM connection status |
| GET | `/api/admin/orgs/[id]` | Single org detail |
| POST | `/api/admin/orgs/[id]/activate` | Set isActive=true, clear Redis suspended key |
| POST | `/api/admin/orgs/[id]/deactivate` | Set isActive=false, set Redis suspended key |
| PUT | `/api/admin/orgs/[id]/plan` | Change plan (FREE/PAID), auto-sync seatsPurchased |
| PUT | `/api/admin/orgs/[id]/seats` | Override seatsPurchased |
| POST | `/api/admin/orgs/[id]/reset` | `{ mode: "soft"\|"hard" }` — see §16 |

### Onboarding / Setup
| Method | Path | Description |
|---|---|---|
| GET | `/api/onboarding/status` | 5-item checklist status |
| GET | `/api/setup/status` | **Public** — polled by SFDC LWC |
| POST | `/api/setup/onboarding-done` | Called by SFDC package post-install |

### Engine Endpoints (port 3001)
| Method | Path | Description |
|---|---|---|
| GET | `/health` | `{ status: "ok", ts: "..." }` |
| POST | `/route` | SFDC webhook — see §8 |

---

## 13. Key Algorithms

### HMAC-SHA256 Signature Validation

**Apex (sender)**:
```apex
Blob hmac = Crypto.generateMac('hmacSHA256', Blob.valueOf(payload), Blob.valueOf(secret));
String signature = 'sha256=' + EncodingUtil.convertToHex(hmac);
req.setHeader('X-Signature-256', signature);
```

**Engine (receiver)**:
```typescript
const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
const expectedHeader = `sha256=${expected}`;
crypto.timingSafeEqual(Buffer.from(expectedHeader), Buffer.from(receivedHeader));
// Uses timing-safe comparison to prevent timing attacks
```

**Critical**: The engine reads the raw request body (not re-serialized JSON) for HMAC validation — byte-for-byte match with what Apex signed.

### Round-Robin (Atomic)

```
Key: rr:{orgId}:{teamId}:pointer

On each routing event:
  INCR key              → returns N (monotonically increasing)
  index = (N-1) % count → 0-based position in active members array
  return activeMembers[index]

On reset:
  SET key 0
```

The Lua script makes INCR + modulo a single atomic operation, preventing race conditions under high concurrency.

### Idempotency

```
Key: idem:{orgId}:{recordId}:{eventType}:{timestamp}
TTL: 3600 seconds (1 hour)

SET key "1" NX EX 3600
  → "OK"   = first time seen → process it
  → null   = already seen → return { status: "duplicate" }
```

Note: The timestamp in the key comes from the Apex payload (`Datetime.now()` at callout time in `RoutingPayloadBuilder`). Two callouts for the same record 1+ second apart will have different timestamps and both be processed. This is expected behavior for update events.

---

## 14. Local Development Setup

### Prerequisites
- Docker (PostgreSQL + Redis)
- Node.js 24.x
- pnpm
- ngrok (for SFDC → local engine tunnel)
- Salesforce CLI (`sf`)

### Services

```bash
# Start PostgreSQL
docker run -d --name pg -e POSTGRES_PASSWORD=password -e POSTGRES_DB=lead_routing -p 5432:5432 postgres:16

# Start Redis
docker run -d --name redis -p 6379:6379 redis:7
```

### Environment Variables

**`apps/web/.env`**:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/lead_routing
REDIS_URL=redis://localhost:6379
SESSION_SECRET=<32+ char random string>
SFDC_CLIENT_ID=<Consumer Key from Connected App>
SFDC_CLIENT_SECRET=<Consumer Secret from Connected App>
SFDC_CALLBACK_URL=http://localhost:3000/api/auth/callback
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**`apps/engine/.env`**:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/lead_routing
REDIS_URL=redis://localhost:6379
PORT=3001
```

### Database Setup
```bash
cd packages/db
pnpm prisma db push  # creates all 12 tables
pnpm prisma generate # generates Prisma client
```

### Running Locally

```bash
# Terminal 1 — Web app
cd apps/web && pnpm dev        # → http://localhost:3000

# Terminal 2 — Engine
cd apps/engine && pnpm dev     # → http://localhost:3001

# Terminal 3 — ngrok tunnel (required for SFDC callouts)
ngrok http 3001                # → https://jalen-cultured-madden.ngrok-free.dev
```

Dev script for engine: `node --env-file=.env --import tsx --watch src/server.ts`
(NOT `tsx watch` — `--env-file` flag is only supported on the `node` command directly)

### SFDC Package Deployment

```bash
# Authenticate
sf org login web --alias lead-router

# Deploy (exclude ConnectedApp)
sf project deploy start \
  --target-org lead-router \
  --metadata ApexClass \
  --metadata ApexTrigger \
  --metadata CustomObject \
  --metadata NamedCredential \
  --metadata LightningComponentBundle \
  --metadata RemoteSiteSettings

# Configure Routing Settings (Setup → Custom Settings → Routing Settings → Manage → New)
# Lead_Routing_Enabled__c = true
# Lead_Insert_Enabled__c = true
# Lead_Update_Enabled__c = false  (avoid OwnerId update loop)
# Webhook_Secret__c = <value from organizations.webhookSecret in DB>
```

---

## 15. CLI — Self-Hosted Installer (`@lead-routing/cli`)

The project is distributed as a self-hosted product via an interactive CLI installer. Customers run `npx @lead-routing/cli init` on their server and the CLI walks them through configuration then deploys the full stack using Docker Compose.

### Package

| Field | Value |
|---|---|
| Package name | `@lead-routing/cli` |
| Location | `apps/cli/` |
| Bin entry | `lead-routing` → `dist/index.js` |
| Build tool | `tsup` (ESM bundle, Node 20 target) |

### Commands

| Command | Description |
|---|---|
| `lead-routing init` | Full interactive setup wizard (9 steps) — SSH remote deploy, inline SFDC deploy, App Launcher guide |
| `lead-routing init --dry-run` | Wizard + local file generation only — connects nothing, deploys nothing |
| `lead-routing init --resume` | Skip steps 1–7; reconnect SSH using saved config and resume from health check (step 8) + SFDC deploy (step 9). Safe re-entry after a Let's Encrypt timeout — no DB wipe. |
| `lead-routing init --sandbox` | Same as init but uses `https://test.salesforce.com` as SFDC login URL |
| `lead-routing init --ssh-key <path>` | Override auto-detected SSH key |
| `lead-routing init --ssh-port <n> --ssh-user <u>` | Override default SSH port (22) and username (root) |
| `lead-routing init --remote-dir <path>` | Override remote install directory (default: ~/lead-routing) |
| `lead-routing init --external-db <url>` | Use external PostgreSQL instead of managed Docker container |
| `lead-routing init --external-redis <url>` | Use external Redis instead of managed Docker container |
| `lead-routing sfdc deploy` | Standalone SFDC package deploy — re-deploy or use from a different machine; includes interactive App Launcher wizard |
| `lead-routing deploy` | Pull latest images via SSH, restart containers on VPS, run migrations via SSH tunnel |
| `lead-routing doctor` | Health check: Docker, containers, HTTP endpoints |
| `lead-routing logs [service]` | Stream logs (web / engine / postgres / redis) |
| `lead-routing status` | Show `docker compose ps` output |
| `lead-routing config show` | Print admin secret, app URL, and SFDC client ID from `.env.web` |
| `lead-routing config sfdc` | Update Salesforce Consumer Key + Secret in `.env.web` / `.env.engine` and restart containers |

### `sfdc deploy` Command

`apps/cli/src/commands/sfdc.ts` — `runSfdcDeploy()`

Thin orchestrator: resolves config, checks `sf` CLI, prompts for org alias, then delegates all deploy logic to `sfdcDeployInline()` (see below). Also runs the interactive App Launcher wizard (same as `init` step 9).

Steps executed in order:
1. Reads `lead-routing.json` via `findInstallDir()` / `readConfig()` — if not found, prompts for App URL and Engine URL directly (supports running from a different machine than where `init` ran)
2. Checks `sf --version` is installed; if missing, prints install URL and exits
3. Prompts for Salesforce org alias (default: `lead-routing`)
4. Calls `sfdcDeployInline({ appUrl, engineUrl, orgAlias })`
5. Calls `guideAppLauncherSetup(appUrl)` — interactive 4-step wizard (same as after full `init`)
6. Prints success + dashboard URL

### `sfdc-deploy-inline` Step

`apps/cli/src/steps/sfdc-deploy-inline.ts` — `sfdcDeployInline(params)`

Shared deploy logic used by both `init` (step 7) and the standalone `sfdc deploy` command. Accepts `{ appUrl, engineUrl, orgAlias, sfdcClientId, sfdcLoginUrl, installDir? }`.

Steps executed in order:
1. **Auth check** — `sf org display --target-org <orgAlias>` — if exit 0, skip login (already authenticated). Otherwise, run the **web app OAuth bridge** (`loginViaAppBridge`):
   - `POST {appUrl}/api/cli-auth/request` → receive `{ sessionId, authUrl }` (auth URL points to Salesforce OAuth with `state=cli:{sessionId}` and `redirect_uri={appUrl}/api/auth/sfdc/callback`)
   - Opens `authUrl` in the browser with the platform `open` / `xdg-open` command
   - Polls `GET {appUrl}/api/cli-auth/poll/{sessionId}` every 2 s (up to 5 min)
   - When browser completes auth, web app exchanges code and stores `{ accessToken, instanceUrl }` in the in-memory CLI auth store; poll returns them to the CLI
   - CLI calls `sf org login access-token --instance-url {instanceUrl} --alias {orgAlias} --no-prompt` with the token piped via stdin to persist credentials in the sf CLI store
   - **Uses `{appUrl}/api/auth/sfdc/callback`** — the same URL already registered in the Connected App for the normal web login flow
2. Copies bundled `sfdc-package/` from CLI dist to `{installDir ?? tmpdir()}/lead-routing-sfdc-package/`
3. **Patches Named Credential XML** — replaces `<endpoint>` with `engineUrl`
4. **Patches Remote Site Setting XMLs** — `LeadRouterEngine → engineUrl`, `LeadRouterApp → appUrl`
5. Runs `sf project deploy start --target-org <alias> --source-dir force-app`
6. Runs `sf org assign permset --name LeadRouterAdmin` — non-fatal; `Duplicate PermissionSetAssignment` treated as success
7. Writes `Routing_Settings__c` — queries for existing record, updates if found, creates if not (avoids `duplicate SetupOwnerId` on re-deploy)

**Why the permission set is needed**: Deploying a `CustomApplication` via SFDX does not automatically grant any user visibility — the App Launcher only shows apps the authenticated user's profile or a permission set has granted access to. `LeadRouterAdmin.permissionset-meta.xml` grants `applicationVisibilities` for `Lead_Router_Setup` and `Visible` visibility for the `Lead_Router_Setup` tab (`Visible` is required; `Available` only lets the user add it manually and does not satisfy the Lightning App nav bar).

### sfdc-package Bundling

The `sfdc-package/` metadata directory must travel with the CLI npm package:

| Step | Mechanism |
|---|---|
| Local copy | `prepare` npm script copies `../../sfdc-package` → `apps/cli/sfdc-package/` |
| npm publish | `"sfdc-package"` added to `"files"` array in `apps/cli/package.json` |
| tsup build | `onSuccess` hook in `tsup.config.ts` copies `apps/cli/sfdc-package/` → `apps/cli/dist/sfdc-package/` |
| Runtime resolve | Checks `join(__dirname, 'sfdc-package')` first (npm install: inside `dist/`), falls back to `join(__dirname, '..', 'sfdc-package')` (monorepo dev) |

### `init` Wizard Steps

`init` is the single command a customer runs from their **local machine**. The CLI SSHes into their server, transfers files, runs Docker remotely, tunnels Postgres for migrations, and runs `sf` locally. The customer never SSHes into their server manually.

**`--resume` flag**: When passed, reads the saved `lead-routing.json`, re-connects SSH (prompts password if key auth wasn't configured), and jumps directly to step 8 (health check) + step 9 (SFDC deploy). Steps 1–7 are skipped — no volume wipe, no re-upload, no migration re-run. Designed for recovery after a Let's Encrypt rate-limit or health-check timeout that hit after migrations already succeeded.

**Prompt count (v0.1.6):** 7 prompts on the happy path (user has a standard SSH key at `~/.ssh/id_ed25519` or `~/.ssh/id_rsa`); 8 prompts if password auth is needed. Down from 24 prompts in v0.1.4.

1. **Local prerequisites** — Checks Node 20+ and Salesforce CLI `sf` on the local machine (hard failure). Docker/port checks have moved to step 5 (remote).
2. **Server connection + immediate SSH test** — Prompts for VPS hostname only. SSH key is **auto-detected** from `~/.ssh/id_ed25519` → `~/.ssh/id_rsa` → `~/.ssh/id_ecdsa` in priority order; if found, no further auth prompts. If the detected/provided key is **rejected by the server** (e.g. wrong key authorized), the CLI warns and falls back to a password prompt — no need to restart init. If no standard key exists at all, prompts for SSH password directly. Port defaults to 22, username to `root`, remote dir to `~/lead-routing` — all overridable via flags. **SSH connection is established immediately after this step** — before app config is collected. A bad host/key causes an early exit rather than a 5-minute wasted setup.
3. **Configuration** — App URL, Engine URL, SFDC Connected App credentials (CLI prints exact setup instructions with callback URL pre-filled), admin email/password. Salesforce environment defaults to production (use `--sandbox` flag for `test.salesforce.com`). Postgres and Redis are managed by Docker by default (use `--external-db`/`--external-redis` flags to skip). Resend email is not collected at init time — configure post-install. After this step, **DNS pre-flight check** — runs `dns.promises.lookup()` on each unique hostname. If a hostname doesn't resolve: shows a warning (typo check), asks `Continue anyway?` — not a hard error.
4. **Generate config files** — Writes locally to `./lead-routing/`: `docker-compose.yml`, `Caddyfile`, `.env.web`, `.env.engine`, `lead-routing.json` (includes `ssh` and `remoteDir` fields). Dry-run exits here.
5. **Remote setup** — Already connected from step 2. Resolves `~` via remote `$HOME`, checks remote Docker 24+ and Docker Compose v2 (hard failure), checks ports 80/443 (warn only), uploads all 5 config files via SFTP.
6. **Start services** — First checks for a stale `{dirName}_postgres_data` volume via `docker volume inspect`; if found runs `docker compose down -v --remove-orphans` to wipe it (prevents POSTGRES_PASSWORD being silently ignored on re-init, which causes Prisma P1000 auth failure). Then SSH exec: `docker compose pull` → `docker compose up -d --remove-orphans`. **Two-phase postgres readiness**: Phase 1 polls `docker compose exec -T postgres pg_isready` (container-internal, up to 60s). Phase 2 polls `bash -c 'echo > /dev/tcp/127.0.0.1/5432'` (host TCP port, up to 8s) — this is what the SSH tunnel actually forwards to; Docker's host-port binding can lag behind container-internal readiness on fresh starts, causing P1001.
7. **Database migrations** — Opens SSH port-forward tunnel: local random port → remote `localhost:5432`. Runs `prisma migrate deploy` and `prisma db execute` seed SQL from local machine using tunneled DATABASE_URL. Closes tunnel when done.
8. **Verify health** — Polls `GET https://{appUrl}/api/health` and `GET https://{engineUrl}/health` (public HTTPS URLs — not localhost). `maxAttempts` raised to 24 (2 min) to allow Caddy TLS cert provisioning (~30s).
9. **Deploy Salesforce package** — Calls `sfdcDeployInline()` locally. First checks if already authenticated (`sf org display --target-org {alias}`) — skips login if so. If not authenticated, uses the **web app OAuth bridge** (`loginViaAppBridge`): requests a sessionId from `POST {appUrl}/api/cli-auth/request`, opens the Salesforce auth URL in the browser, polls `GET {appUrl}/api/cli-auth/poll/{sessionId}` until the token arrives, then stores credentials with `sf org login access-token`. **Only one Connected App callback URL required** — `{appUrl}/api/auth/callback` (already registered; no `localhost:1717` URL needed). Then patches + deploys SFDC package → assigns `LeadRouterAdmin` permission set → writes `Routing_Settings__c`.
+ **App Launcher wizard guide** — Prints 4-step wizard instructions, waits for customer confirm.

### SSH Architecture

| Component | Location |
|-----------|----------|
| `src/utils/ssh.ts` | `SshConnection` class wrapping `node-ssh` — provides `exec`, `execSilent`, `upload` (SFTP), `mkdir`, `resolveHome`, `tunnel`, `disconnect` |
| `src/steps/collect-ssh-config.ts` | Prompts for host only; auto-detects SSH key from standard locations; accepts `SshCollectOptions` for flag overrides |
| `src/steps/check-remote-prerequisites.ts` | SSH exec: Docker version, Compose version, port availability |
| `src/steps/upload-files.ts` | SFTP upload of 5 generated files to `remoteDir` |
| `src/steps/start-services.ts` | SSH exec: docker compose pull + up + pg_isready polling |
| `src/steps/run-migrations.ts` | SSH tunnel to port 5432, prisma commands run locally via tunnel |

### SSH Tunnel (Postgres Migrations)

`ssh.tunnel(5432)` creates a local `net.Server` on a random port. Each incoming socket is piped through `ssh2.Client.forwardOut` to `localhost:5432` on the remote server. `getTunneledDbUrl()` rebuilds `DATABASE_URL` with `hostname=localhost` and `port={localPort}` using the `URL` constructor. Tunnel is closed in a `finally` block after migrations + seed complete.

### `lead-routing.json` Schema (post-SSH)

```json
{
  "appUrl": "https://leads.acme.com",
  "engineUrl": "https://engine.acme.com",
  "installDir": "/Users/customer/myproject/lead-routing",
  "remoteDir": "/root/lead-routing",
  "ssh": {
    "host": "165.22.100.50",
    "port": 22,
    "username": "root",
    "privateKeyPath": "/Users/customer/.ssh/id_rsa"
  },
  "dockerManaged": { "db": true, "redis": true },
  "installedAt": "2026-03-01T12:00:00.000Z",
  "version": "0.1.0"
}
```
SSH password is never persisted. Future commands (`deploy`, `logs`, `status`) will read `ssh` from this file to reconnect.

### Docker Compose

Pre-built images pulled from `ghcr.io/lead-routing/`:
- `caddy:2-alpine` — reverse proxy with auto-HTTPS via Let's Encrypt (ports 80 + 443)
- `ghcr.io/lead-routing/web:latest` — Next.js app (bound to `127.0.0.1:3000` — not public)
- `ghcr.io/lead-routing/engine:latest` — Fastify engine (bound to `127.0.0.1:3001` — not public)
- `postgres:16-alpine` — only if Docker-managed DB chosen (bound to `127.0.0.1:5432` — not public)
- `redis:7-alpine` — only if Docker-managed Redis chosen

Internet traffic flows: `Caddy:443 → web:3000` and `Caddy:443/3001 → engine:3001` via Docker internal network. Web and engine ports are NOT exposed to the internet directly.

### ENGINE_URL Split

Two separate engine URL values exist post-init:
- **`ENGINE_URL=http://engine:3001`** in `.env.web` — Docker service name for web→engine internal communication
- **`engineUrl` in `lead-routing.json`** — the user-provided public HTTPS URL (e.g. `https://engine.acme.com`) used for Salesforce Named Credential patching

### Caddyfile Generation

Template in `apps/cli/src/templates/caddy.ts` — `renderCaddyfile(appUrl, engineUrl)`:
- **Case A** (subdomain engine URL, e.g. `https://engine.acme.com`): two site blocks, separate certs
- **Case B** (same domain + port, e.g. `https://acme.com:3001`): second listener on the port, reuses cert

Written to `./lead-routing/Caddyfile` alongside `docker-compose.yml`.

### Config Persistence

`lead-routing.json` is written into the install directory. It is read by `deploy`, `doctor`, `logs`, and `status` to know the install location, URLs, and which services are Docker-managed.

### File Structure

```
apps/cli/
├── src/
│   ├── index.ts                    # Commander root (init, sfdc, deploy, doctor, logs, status, config)
│   ├── commands/                   # init, sfdc, deploy, doctor, logs, status, config
│   ├── steps/                      # prerequisites, collect-ssh-config, collect-config,
│   │                               #   check-remote-prerequisites, generate-files,
│   │                               #   upload-files, start-services, run-migrations,
│   │                               #   verify-health, sfdc-deploy-inline, app-launcher-guide
│   ├── templates/                  # docker-compose.ts, env-web.ts, env-engine.ts
│   └── utils/                      # exec.ts, config.ts, crypto.ts, ssh.ts
├── sfdc-package/                   # Copy of repo-root sfdc-package/ (bundled with npm package)
├── tsup.config.ts                  # onSuccess copies sfdc-package/ → dist/sfdc-package/
├── package.json                    # "files": ["dist/", "sfdc-package/"]
└── tsconfig.json
```

### Key Dependencies

| Package | Purpose |
|---|---|
| `@clack/prompts` | Interactive wizard with spinners |
| `commander` | Command / subcommand routing |
| `execa` | Shell command execution |
| `chalk` | Terminal colour output |
| `node-ssh` | SSH connection, SFTP file upload, port-forward tunneling. **Note:** `ssh2` (transitive dep) has optional native modules (`cpu-features`, `sshcrypto`) — pnpm skips their build scripts by default. This is fine; `ssh2` uses pure-JS fallbacks. Do NOT use `noExternal: [/.*/]` in `tsup.config.ts` — it causes build failures trying to bundle the uncompiled `.node` files. Leave `node-ssh` as a runtime external (default tsup behavior); it resolves from `apps/cli/node_modules/` during dev and from the global install `node_modules/` when published. |

---

## 16. Docker Images

Production Docker images are built for `apps/web` and `apps/engine`. They are published to GitHub Container Registry (ghcr.io) and pulled automatically by the CLI-generated Docker Compose configuration. Customers do not need a GitHub account or credentials — the packages are public.

### Registry & Image Names

| Image | Registry URL |
|---|---|
| Web (Next.js) | `ghcr.io/atgatzby/lead-routing-web:latest` |
| Engine (Fastify) | `ghcr.io/atgatzby/lead-routing-engine:latest` |

### CI/CD — GitHub Actions

Workflow file: `.github/workflows/publish-images.yml`

Triggers:
- Push to `main` → publishes `:latest` and `:<branch>` tags
- Push of a `v*` tag → publishes `:<version>` and `:<major>.<minor>` tags

Uses `GITHUB_TOKEN` (no extra secrets required). Packages must be set to **Public** in GitHub UI after the first push (`github.com/<owner> → Packages → lead-routing-web/engine → Package settings → Change visibility → Public`). Caches Docker layers with `type=gha` for faster subsequent builds.

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Multi-stage builds | Builder stage has full devDeps; runner stage is minimal |
| `--shamefully-hoist` in builder | Flattens pnpm virtual store so files can be `COPY`'d between stages cleanly |
| Engine built with `tsup` (`build:prod`) | `packages/db` and `packages/sfdc` export TypeScript source — tsup bundles them inline so no TS runtime is needed in production |
| `@prisma/client` kept external | Prisma ships native query-engine binaries per platform — cannot be bundled |
| Next.js `output: 'standalone'` | Produces a self-contained server with only required node_modules |
| `outputFileTracingRoot` = monorepo root | Allows Next.js file tracer to follow imports across workspace packages |

### Engine Dockerfile (`apps/engine/Dockerfile`)

```
Builder stage:
  pnpm install --shamefully-hoist
  prisma generate
  tsup  →  dist/server.js  (workspace packages inlined)

Runner stage (node:24-alpine):
  pnpm install --prod --shamefully-hoist   (installs fastify, bullmq, ioredis, etc.)
  dist/server.js                           (copied from builder; workspace pkgs inlined by tsup)
  node_modules/.prisma/                    (native query engine — copied from builder)
  node_modules/@prisma/                    (JS client wrapper — copied from builder)
  packages/db/prisma/                      (schema for migrate deploy)
```

### Web Dockerfile (`apps/web/Dockerfile`)

```
Builder stage:
  pnpm install --shamefully-hoist
  prisma generate
  next build  →  .next/standalone/

Runner stage (node:24-alpine):
  .next/standalone/       (includes traced node_modules)
  apps/web/.next/static/
  apps/web/public/
```

### Engine Production Bundle (`apps/engine/tsup.config.ts`)

tsup config bundles `@lead-routing/db` and `@lead-routing/sfdc` inline and externalises `@prisma/client`:

```ts
noExternal: ['@lead-routing/db', '@lead-routing/sfdc']
external:   ['@prisma/client']
```

### `.dockerignore` (root)

Excludes: `**/node_modules`, `**/.next`, `**/dist`, `**/.env*`, `lead-routing/` (install dir), `.git/`, docs, preview files.

### Publishing Images

Tag and push after building:
```bash
docker build -f apps/web/Dockerfile    -t ghcr.io/lead-routing/web:latest .
docker build -f apps/engine/Dockerfile -t ghcr.io/lead-routing/engine:latest .
docker push ghcr.io/lead-routing/web:latest
docker push ghcr.io/lead-routing/engine:latest
```

---

## 17. Known Issues & Fixes

### OwnerId Update Loop
**Problem**: The engine sets `OwnerId` on a Lead → SFDC fires `after update` trigger → engine processes the update again (UNMATCHED, but creates an extra log entry).
**Fix**: Set `Lead_Update_Enabled__c = false` in SFDC Custom Setting unless update routing is intentionally needed.

### Field Name Case Mismatch
**Problem**: SFDC's `JSON.serialize()` lowercases all field names in the payload (e.g. `firstname`, `leadsource`), but Prisma stores field API names in Pascal case (e.g. `FirstName`, `LeadSource`).
**Fix**: Evaluator uses fallback lookup: `record[fieldName] ?? record[fieldName.toLowerCase()]` — see `apps/engine/src/evaluator.ts:16`.

### jsforce in Client Components
**Problem**: `@lead-routing/sfdc` imports jsforce which imports Node.js `child_process` — this breaks the browser bundle.
**Fix**: Never import `@lead-routing/sfdc` in client components. Use `apps/web/lib/operators.ts` (browser-safe copy of operator definitions) in `condition-builder/` components.

### Next.js 16 Middleware
**Problem**: Next.js 16 uses `proxy.ts`, not `middleware.ts`. If both files exist, the app crashes.
**Fix**: Auth middleware lives at `apps/web/proxy.ts`. Do not create `middleware.ts`.

### Webhook Secret / Settings Mismatch (→ 401)
**Symptom**: Engine returns 401 "Invalid signature" for SFDC callouts.
**Root cause**: If the DB is reset, a new `webhookSecret` is generated that no longer matches `Webhook_Secret__c` in Salesforce.
**Auto-sync (implemented)**: `pushSettings()` in `packages/sfdc/src/settings.ts` is called at three points:
1. **SFDC OAuth callback** (`/api/auth/sfdc/callback`) — every time the user reconnects their Salesforce org
2. **Onboarding completion** (`/api/setup/onboarding-done`) — when the SFDC package marks setup done
3. **Manual sync** (`/api/settings/sync-sfdc`) — Settings → "Salesforce Connection" → **Sync Webhook Secret** button

`pushSettings()` writes three values to `Routing_Settings__c` (data API) and also re-syncs the Named Credential endpoint and Remote Site Setting URL via jsforce Metadata API (`conn.metadata.upsert`). Metadata API calls are non-fatal — failures are logged but don't block the data write.

**Emergency fix** (all else fails):
```sql
SELECT "webhookSecret" FROM organizations LIMIT 1;
```
Paste into SFDC Setup → Custom Settings → Routing Settings → Manage → `Webhook_Secret__c`.

**Key files**: `packages/sfdc/src/settings.ts` (`pushSettings`), `apps/web/app/api/settings/sync-sfdc/route.ts`.

### Hardcoded App URL in LWC / Apex (Fixed)
**Problem**: `OnboardingController.cls` had `private static final String APP_BASE_URL = 'https://app.leadrouter.io/api'` and `onboardingWizard.js` had `const APP_URL = 'https://app.leadrouter.io'` — breaking every self-hosted customer.
**Fix**: Removed the hardcoded constants. `OnboardingController` now reads `Routing_Settings__c.App_Url__c` via a private `getAppBaseUrl()` helper (throws `AuraHandledException` if blank). The LWC calls `getAppUrl()` and `getOrgId()` in `connectedCallback()` and shows a loading spinner / error banner until the values resolve. `App_Url__c` is seeded by `lead-routing sfdc deploy` immediately after package deployment.

### SFDC Package Deployment Quirks
- `NamedCredential`: Do NOT include a `<name>` tag — the name is derived from the filename
- `Routing_Error_Log__c`: Must include `<deploymentStatus>Deployed</deploymentStatus>`
- `LWC meta`: Remove empty `<targetConfigs>` blocks
- `ConnectedApp`: Skip during deployment — too many format issues; use org's existing Connected App
- After deployment, grant FLS on `Routing_Error_Log__c` fields via a Permission Set
- `CustomApplication isNavPersonalizationDisabled`: Must be `true`. If set to `false`, Salesforce persists an empty personalized nav bar for any user who visited the app before the tab was accessible — subsequent deploys don't clear that saved state, causing "No Items" permanently. With `true`, the app always uses its declared `<tabs>` and ignores saved personalization.
- `onboardingWizard.js handleConnect()`: Opens `{appUrl}/api/auth/sfdc/login` (NOT `/auth/sfdc` — that route does not exist in Next.js). The `/api/auth/sfdc/login` route redirects to Salesforce OAuth; callback at `/api/auth/sfdc/callback` stores tokens and redirects to `/dashboard?crm_connected=1`. After the popup completes, the LWC's `checkConnectionStatus` poll detects the stored connection.
- **PKCE**: Salesforce Connected Apps with "Require Proof Key for Code Exchange" enabled reject auth requests without `code_challenge`. `getSfdcAuthUrl(codeChallenge?)` in `packages/sfdc/src/client.ts` now accepts an optional challenge; `generatePkceVerifier()` / `generatePkceChallenge()` generate the pair. The login route stores `codeVerifier` in `session.sfdcCodeVerifier` (iron-session); the callback reads it, clears it, and passes it to `exchangeCodeForTokens(code, codeVerifier?)`. Token exchange is now done via raw `fetch` to `/services/oauth2/token` (jsforce's `conn.authorize()` doesn't support `code_verifier`).
- **`POST /api/fields/sync` auth**: This endpoint is called by Apex (server-to-server callout), not from a browser — there is no iron-session cookie. The route now authenticates via `X-Sfdc-Org-Id` header (sent by `OnboardingController.syncFieldSchema`) and looks up the org by `sfdcOrgId`. Previously it used `getActorFromHeaders()` (which reads `x-org-id` injected by middleware), causing a "Missing auth headers" 500 on every sync attempt.
- **Apex callout endpoints must be in `PUBLIC_PREFIXES`**: `proxy.ts` (Next.js middleware) blocks all unauthenticated requests. Salesforce Apex callouts carry no iron-session cookie. Any endpoint called from Apex must be listed in `PUBLIC_PREFIXES`. Currently: `/api/setup/` (status + onboarding-done) and `/api/fields/sync`. The CLI OAuth bridge endpoints `/api/cli-auth/` are also in `PUBLIC_PREFIXES` (called by the CLI, not by a browser session).
- **CLI OAuth Bridge** (`apps/web/app/api/cli-auth/`): The CLI authenticates with Salesforce without requiring `localhost:1717` in the Connected App by routing through the deployed web app:
  - `POST /api/cli-auth/request` — creates a random `sessionId`, generates a PKCE S256 pair (`code_verifier` + `code_challenge`), stores the verifier in the cli-auth-store, builds the Salesforce auth URL with `redirect_uri={SFDC_REDIRECT_URI}&state=cli:{sessionId}&code_challenge=...&code_challenge_method=S256`, returns `{ sessionId, authUrl }` to the CLI.
  - `GET /api/cli-auth/poll/{sessionId}` — returns `{ status: 'pending' | 'ok' | 'expired' }`. On `ok`, includes `accessToken` and `instanceUrl`. Token is consumed (deleted) on first successful poll.
  - `GET /api/auth/sfdc/callback` — handles **both** CLI and web flows. Detects `state=cli:{sessionId}`: retrieves stored `code_verifier` from cli-auth-store, exchanges the OAuth code for tokens directly (includes `code_verifier` in token exchange body for PKCE), stores tokens in cli-auth-store, returns a `text/html` "You may close this tab" page. For non-CLI state, proceeds with the normal iron-session org association flow.
  - `GET /api/auth/callback` — legacy shim: forwards all query params to `/api/auth/sfdc/callback` (handles bookmarked or cached old-format OAuth redirects).
  - In-memory store (`apps/web/lib/cli-auth-store.ts`) — stores `{ status, codeVerifier, accessToken, instanceUrl, expiresAt }`. Suitable for single-process self-hosted deployment; no Redis required.
- **Engine MUST be on a public URL**: The Apex trigger reads `Engine_Endpoint__c` from `Routing_Settings__c` and calls the engine directly. Salesforce cannot reach `localhost:3001`. For local dev, use `ssh -R 80:localhost:3001 localhost.run` to get a public HTTPS tunnel (URL changes on restart — update `lead-routing.json` `engineUrl` and re-run `lead-routing sfdc deploy` to update `Engine_Endpoint__c` and the Remote Site Setting). For production, the engine should be on a stable public URL.
- **Named Credential URL not updated by Metadata API re-deploy**: Salesforce's Metadata API silently ignores `<endpoint>` changes in Named Credential XML when the credential already exists. This is why `RoutingEngineCallout` was migrated to read the engine URL from `Routing_Settings__c.Engine_Endpoint__c` (updated reliably via `sf data update record`) rather than using `callout:RoutingEngine/route`.
- **`appUrl` leading space**: `@clack/prompts text()` does not trim input. A pasted URL with a leading space propagates to `.env.web` `APP_URL` / `SFDC_REDIRECT_URI` and `lead-routing.json`. Fixed in `collect-config.ts` with `.trim()` on `appUrl`.

### Engine Dev Command
Use `node --env-file=.env --import tsx --watch src/server.ts`, **not** `tsx watch src/server.ts`. The `--env-file` flag only works on the `node` command directly, not via `tsx`.

### BullMQ Redis Connection
BullMQ requires a dedicated ioredis connection with `maxRetriesPerRequest: null`. Reusing the standard command connection will throw errors.

### Docker Build — Known Fixes (verified during first end-to-end build)

| Symptom | Root Cause | Fix |
|---|---|---|
| `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` | `pnpmfileChecksum` in lockfile doesn't match the Docker environment | Use `--no-frozen-lockfile` in both Dockerfiles instead of `--frozen-lockfile` |
| `COPY /app/node_modules/.prisma` fails (runner stage) | pnpm puts the generated Prisma client in its virtual store, not root `node_modules` | Add `output = "../../../node_modules/.prisma/client"` to `schema.prisma` generator block; run `prisma generate` from the repo root with `--schema` path |
| `Module not found: Can't resolve 'bullmq'` | `bullmq` only in engine's `package.json`, but web's retry route also imports it | Added `"bullmq": "^5.0.0"` to `apps/web/package.json` |
| `outputFileTracingRoot` invalid experimental key | Moved to top-level Next.js config in Next.js 15+ | Move `outputFileTracingRoot` out of `experimental` block in `next.config.ts` |
| `Property 'userId' does not exist on type 'IronSession<SessionData>'` | `SessionData` uses `appUserId`, not `userId` | Changed `session.userId` → `session.appUserId` in `app/api/auth/me/route.ts` |
| `Type 'string \| null' is not assignable to type 'string'` (5 API routes) | Prisma OAuth fields are nullable; `createConnection()` expects `string` | Added null guard before every `createConnection()` call across all SFDC-touching routes |
| `Type 'null' is not assignable to NullableJsonNullValueInput` | Plain `null` is ambiguous for Prisma JSON fields | Use `Prisma.JsonNull` for nullable JSON columns in audit log `afterState` |
| Prisma model (with `Date` fields) not assignable to `InputJsonValue` | Prisma model objects contain `Date` instances which aren't JSON-serialisable | Wrap with `JSON.parse(JSON.stringify(obj))` before passing to audit log `beforeState`/`afterState` |
| `useSearchParams() should be wrapped in a Suspense boundary` (prerender) | `useSearchParams()` at page level causes static prerender to fail; `export const dynamic` does **not** suppress this | Move all page logic to an inner `NewRuleContent` component and wrap with `<Suspense>` in the default export (`routing-rules/new/page.tsx`) |
| `Cannot find module '@prisma/engines'` during `prisma migrate deploy` | Web runner stage (Next.js standalone) doesn't include `@prisma/engines` (native migration binary) | Copy `node_modules/@prisma`, `node_modules/.prisma`, `node_modules/prisma`, `node_modules/.bin/prisma`, and `packages/db/prisma` from builder to runner in web Dockerfile |
| `npx prisma migrate deploy` downloads wrong prisma version | `npx` resolves the latest published prisma, not the project's pinned version | Use `node_modules/.bin/prisma migrate deploy --schema packages/db/prisma/schema.prisma` inside the container instead |
| `Cannot find module '@lead-routing/db'` in seed script | `@lead-routing/db` exports TypeScript source — not directly importable at raw Node.js runtime in the standalone container | Changed seed script from `import { prisma } from '@lead-routing/db'` to `import { PrismaClient } from '@prisma/client'` |
| Docker healthcheck + CLI verify-health return 404 | `/api/health` route was missing in the web app | Created `apps/web/app/api/health/route.ts` returning `{ ok: true }` (no DB import — safe to call before migrations) |

### CLI Init — Runtime Fixes (first full end-to-end run)

| Symptom | Root Cause | Fix |
|---|---|---|
| `P1001: Can't reach database server at localhost:5432` | Postgres service had no `ports:` mapping — host CLI couldn't reach it | Added `ports: ["5432:5432"]` to postgres service in `docker-compose.ts` template |
| `PrismaClientValidationError: findUnique where needs id or orgId_email` | Seed used `findUnique({ where: { email } })` but `email` is only unique per-org | Replaced entire seed with `prisma db execute --stdin` + raw SQL |
| `Cannot find package '@prisma/client'` in inline eval | pnpm puts `@prisma/client` in `packages/db/node_modules/`, not workspace root; `--eval` resolves from CWD | Dropped the inline ESM eval approach entirely — seed now uses `prisma db execute --stdin` |
| `Failing row contains (... null, null, null, null ...)` on org INSERT | `sfdcOrgId/sfdcInstanceUrl/oauthAccessToken/oauthRefreshToken` are `NOT NULL` in the init migration but `String?` in the schema | Created migration `20260227000000_self_hosted_schema_updates` — makes those columns nullable |
| `app_users` table does not exist | `AppUser` and `Invite` models were added to the Prisma schema but no migration was created for them | Same migration — creates `app_users` and `invites` tables |
| `plan`, `isActive`, `routingQuotaUsed`, `quotaResetAt` missing from `organizations` | Schema drifted from migrations; new columns existed in Prisma schema but not in any migration SQL | Same migration — adds `Plan` enum and all four columns with defaults |
| `recordSnapshot` column missing from `routing_logs` | Added to schema but not to any migration | Same migration — `ALTER TABLE routing_logs ADD COLUMN IF NOT EXISTS "recordSnapshot" JSONB` |
| Admin login fails with "Invalid email or password" | Seed computed password hash as plain SHA-256, but web app's `verifyPassword()` uses PBKDF2 `salt:hash` format | Fixed seed to use `crypto.pbkdf2Sync(password, salt, 310000, 32, 'sha256')` — matches `apps/web/lib/crypto.ts:hashPassword()` |
| SFDC OAuth callback redirects to Docker internal hostname (`8f1bd3f6d8b4:3000`) — browser gets "Site cannot be reached" | `new URL("/api/auth/sfdc/callback", req.url)` uses `req.url` which inside Docker resolves to the container hostname, not the public URL | Both `/api/auth/callback` and `/api/auth/sfdc/callback` now use `process.env.APP_URL` as the base for all `NextResponse.redirect()` calls |
| Engine container crash-loops with `Cannot find package 'fastify'` | `tsup` bundles only workspace packages (`@lead-routing/db`, `@lead-routing/sfdc`) and leaves third-party deps (fastify, bullmq, ioredis) external, but the old runner stage had no `node_modules` at all | Runner stage now runs `pnpm install --prod --shamefully-hoist` before copying the built `dist/` — installs all production runtime deps without needing devDeps |
| Engine crash-loops with `Dynamic require of "punycode" is not supported` | jsforce → node-fetch → `whatwg-url@5.0.0` uses `require('punycode')` (removed from Node 24); tsup's ESM `__require` shim blocks all dynamic requires | Switched tsup to `format: ['cjs']`, removed `"type":"module"` from engine `package.json`, moved `await app.register()` inside `start()` — CJS loads CJS deps natively without the shim |
| Engine `Authentication failed` for `leadrouting` user | Postgres data volume was initialized with a different password in a prior run; `POSTGRES_PASSWORD` env var only applies during first `initdb` | Reset password via `docker compose exec postgres psql -U leadrouting -c "ALTER USER leadrouting PASSWORD '...';"` |
| `prisma migrate deploy` fails with `npm i @prisma/client@x.y.z --silent` error (global install) | Prisma auto-runs `prisma generate` before migrating; in a global install the inferred project root is `/` (no `package.json`), so Prisma tries to install `@prisma/client` via npm and fails | Pass `--skip-generate` to `prisma migrate deploy` in `run-migrations.ts` — the CLI only executes SQL migrations and has no need for `@prisma/client` |

### Salesforce OAuth Connection (Self-Hosted)

The CLI `init` wizard collects OAuth app credentials (`SFDC_CLIENT_ID`, `SFDC_CLIENT_SECRET`, `SFDC_LOGIN_URL`) and writes them to `.env.web`. The actual OAuth authorization — granting the app access to a specific Salesforce org — must happen in the browser via **Settings → Connect Salesforce** in the web app. CLI cannot do browser-based OAuth redirects.

**Callback URL setup**: The Salesforce Connected App must have the exact `SFDC_REDIRECT_URI` (`{APP_URL}/api/auth/sfdc/callback`) listed in its **Callback URLs**. This single URL covers both the normal web login flow and the CLI OAuth bridge — `SFDC_REDIRECT_URI` in `.env.web` is generated as `{appUrl}/api/auth/sfdc/callback`. Without this, Salesforce will reject the OAuth attempt with `redirect_uri_mismatch`.

---

## 18. Admin Portal & Subscription Tiers

### Subscription Tiers

| Plan | Seats | Routing Leads/Month | Notes |
|------|-------|---------------------|-------|
| FREE | 5 | 100 | Default for all new orgs |
| PAID | 20 | 1,000 | Admin manually upgrades via `/admin/orgs/[id]` |

Constants live in `packages/db/src/plan-limits.ts` and exported from `@lead-routing/db`. No payment integration — upgrades are handled manually by the platform admin.

### Admin Portal

Accessible at `/admin` (separate from the main dashboard). Protected by `admin_token` cookie (8-hour HMAC-SHA256, validated in `proxy.ts`).

**Env var required**: `ADMIN_SECRET` in `apps/web/.env.local`

**Pages**:
- `/admin/login` — password form
- `/admin/orgs` — org list table (plan, seats, quota, status)
- `/admin/orgs/[id]` — org detail with all management actions

**Key files**:
- `apps/web/lib/admin-auth.ts` — `signAdminToken()` / `validateAdminToken()`
- `apps/web/lib/org-status.ts` — Redis suspended flag helpers
- `apps/web/app/(admin)/` — route group (no URL prefix)
- `apps/web/app/api/admin/` — all admin API routes

### Quota Enforcement Flow (Engine)

1. After HMAC validation, engine checks `org.isActive` → 403 if suspended
2. Lazy quota reset: if `org.quotaResetAt < now`, reset counter and advance to start of next month
3. Quota gate: if `routingQuotaUsed >= PLAN_LIMITS[plan].routingLeadsPerMonth` → 429
4. After successful routing, increment `routingQuotaUsed` with atomic `{ increment: 1 }` Prisma update

### Org Reset Modes

**Soft reset** (via `/api/admin/orgs/[id]/reset`):
- Deletes all `routing_logs`
- Resets `routingQuotaUsed = 0`, `quotaResetAt = startOfNextMonth()`
- Preserves: rules, users, teams, billing info

**Hard reset**:
- Deletes: rule_conditions, routing_rules, team_members, round_robin_teams, routing_logs, audit_logs, field_schemas, sfdc_queues, users
- Resets org to onboarding state: `seatsUsed=0, routingQuotaUsed=0, onboardingDone=false`
- Preserves: org record, billing info
- **Publishes Redis cache invalidation** for all 3 object types so engine flushes stale rules

### Self-Hosted Seed Values (CLI init)

`apps/cli/src/steps/run-migrations.ts` — `seedAdminUser()` seeds the org with self-hosted defaults so no quota/seat enforcement ever triggers:

| Field | Self-hosted value | Effect |
|---|---|---|
| `plan` | `PAID` | All PAID-tier features enabled from day one |
| `seatsPurchased` | `9999` | Seat cap never reached; seat enforcement UI never shown |
| `isActive` | `true` | Org is active on first login |

Note: `routingQuota` is **not** a schema column — the quota limit is derived from `PLAN_LIMITS[plan]` in the engine. `PAID` plan has a quota limit that is effectively unlimited for self-hosted use.

These values mean all SaaS quota/upgrade UI is permanently inert without any code changes to the engine quota gate or seat-cap API routes.

### ESM Workspace Packages
`packages/db` and `packages/sfdc` both need in their `package.json`:
```json
{
  "type": "module",
  "exports": { ".": "./src/index.ts" }
}
```
And jsforce (CJS) must be imported as:
```typescript
import jsforce from "jsforce";
const { Connection: ConnectionClass } = jsforce;
import type { Connection } from "jsforce";  // type-only
```

## 19. npm Publishing (`@lead-routing/cli`)

### Package Configuration

`apps/cli/package.json` additions required for scoped public publishing:

| Field | Value | Purpose |
|-------|-------|---------|
| `publishConfig.access` | `"public"` | Required so `npm publish` doesn't fail for `@lead-routing/*` scoped packages |
| `engines.node` | `">=20"` | Prevents install on unsupported Node versions |
| `prepublishOnly` script | `"pnpm build"` | Ensures fresh `dist/` before any manual `npm publish` |

### What Gets Published

The `"files": ["dist/"]` field restricts the tarball to:
```
dist/
├── index.js           # Bundled CLI (shebang + ESM, ~64 KB)
├── prisma/
│   ├── schema.prisma
│   └── migrations/    # 4 SQL migration files
└── sfdc-package/      # 47 Salesforce metadata files (Apex, LWC, objects, triggers)
```

Assets are bundled by `tsup`'s `onSuccess` hook in `apps/cli/tsup.config.ts` — no monorepo access needed at runtime.

### Runtime Dependencies (installed by npm, not bundled)

| Package | Why external |
|---------|-------------|
| `node-ssh@^13.2.1` | Has optional native `.node` modules — bundling with tsup fails |
| `prisma@^6.5.0` | Platform-specific query engine binaries selected automatically at install |
| `@prisma/client@^6.5.0` | Required by Prisma internals |

### Known Bugs Fixed (v0.1.4 audit)

| Bug | File | Fix |
|-----|------|-----|
| Connected App callback URL showed `/api/auth/callback` but web app sends `/api/auth/sfdc/callback` as `redirect_uri` — Salesforce would return `redirect_uri_mismatch` | `collect-config.ts` | Now shows correct `/api/auth/sfdc/callback` |
| `appUrl` not validated for HTTPS — Salesforce rejects HTTP redirect URIs | `collect-config.ts` | Added HTTPS validation matching the engine URL check |
| `sfdcClientId` / `sfdcClientSecret` not trimmed — pasted values with trailing spaces broke auth silently | `collect-config.ts` | Added `.trim()` on both |
| `deploy.ts` called `runMigrations(ssh, dir, '', '')` — attempted to create an `app_user` with `email=''` on every deploy | `deploy.ts` + `run-migrations.ts` | `adminEmail`/`adminPassword` are now optional; seeding is skipped when omitted; deploy calls `runMigrations(ssh, dir)` |
| `lead-routing.json` always wrote `version: '0.1.0'` | `generate-files.ts` | Reads actual version from bundled `package.json` at runtime |

### Port Conflict Auto-Remediation (`check-remote-prerequisites.ts`)

`checkRemotePort()` no longer just warns — it actively tries to free the port:
1. Checks if `nginx`, `apache2`, `httpd`, `lighttpd`, or `caddy` is an active systemd service
2. If found: runs `systemctl stop <svc> && systemctl disable <svc>`, then re-checks the port
3. If freed: logs success ("Port 80 — freed (stopped system nginx service)")
4. If still blocked: **hard error** (not a warning) with the occupant process shown — Caddy cannot obtain TLS certs without ports 80/443, so continuing would guarantee a health-check timeout

### Health Check Diagnostics (`verify-health.ts`)

`verifyHealth()` now accepts `ssh` and `remoteDir`. On timeout:
1. Runs `docker compose ps` via SSH → prints container status table
2. Runs `docker compose logs caddy --tail 30` via SSH → prints Caddy output (shows TLS errors, port binding failures, Let's Encrypt rate limits)
3. **Throws** with a remediation message — fixes the previous silent continue → SFDC deploy failure cascade

### Salesforce Auth — Token Passthrough Pattern

`loginViaAppBridge()` now returns `{ accessToken, instanceUrl, aliasStored }`:

- Stores the alias via `sf org login access-token` using `SFDX_ACCESS_TOKEN` env var (more reliable than stdin with `--no-prompt`).
- If storage fails (`aliasStored: false`), all subsequent `sf` commands receive `SF_ACCESS_TOKEN` + `SF_ORG_INSTANCE_URL` env vars and `--target-org` is omitted — `sf` uses the env vars as the default org identity.
- If storage succeeds, env vars are still passed (belt-and-suspenders) and `--target-org orgAlias` is used as normal.

### GitHub Actions Auto-Publish

Workflow: `.github/workflows/publish-cli.yml`

**Trigger**: Push a Git tag matching `cli-v*` (e.g. `cli-v0.1.0`) or manual `workflow_dispatch`.
Decoupled from `publish-images.yml` (Docker) — CLI and Docker releases are independent.

**Steps**: checkout → pnpm install → `pnpm --filter @lead-routing/cli build` → `npm publish --access public`

**Required secret**: `NPM_TOKEN` — npm Classic Automation token added to GitHub repo secrets (NOT a Granular token — those require "Bypass 2FA" set separately).

### Release Process

1. Edit `version` in `apps/cli/package.json`
2. Commit + push tag: `git tag cli-v0.x.y && git push origin cli-v0.x.y`
3. GitHub Actions publishes to npm automatically

### Customer Install

```bash
# One-time setup wizard
npx @lead-routing/cli@latest init

# Subsequent commands (reads lead-routing.json)
lead-routing deploy
lead-routing status
lead-routing doctor
lead-routing logs engine
lead-routing sfdc deploy
```
