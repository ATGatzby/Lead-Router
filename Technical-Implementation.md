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
│       ↑                                                          │
│  Named Credential: callout:RoutingEngine                        │
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
│  - Settings (Billing/GST, Webhook notifications)               │
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
| seatsPurchased | Int | Default 5 (FREE tier); overridable by admin |
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
- **License toggle**: `POST /api/users/[id]/license` / `de-license` — enforces `seatsPurchased` cap
- **Bulk license**: `POST /api/users/bulk-license`
- Seat usage tracked on `Organization.seatsUsed`

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

- **Billing** (`/settings/billing`): GST entity name, GSTIN, address, invoice email
- **Notifications** (`/settings/notifications`): WhatsApp/Slack webhook URL — engine fires this on every successful routing
- **Upgrade modal**: INR pricing (₹2,999 Starter / ₹6,999 Growth / Custom Enterprise)

### Feedback Widget

A floating feedback button is rendered on every dashboard page via `apps/web/app/(dashboard)/layout.tsx`.

- **Trigger**: Fixed `bottom-6 right-6` circular button with `MessageSquare` icon
- **Dialog**: Category select (General / Bug Report / Feature Request) + Textarea (min 10 chars, max 2000)
- **States**: idle → submitting → success (auto-close 1.5s) / error (inline message)
- **API**: `POST /api/feedback` — auth-gated, sends email via **Resend** to `FEEDBACK_TO_EMAIL`
- **Email service**: `resend` package (`apps/web`). Requires `RESEND_API_KEY` and `FEEDBACK_TO_EMAIL` in `.env.local`
- **From address**: `onboarding@resend.dev` (Resend's test domain — works without domain verification)

Key files:
- `apps/web/components/feedback/FeedbackButton.tsx` — client component (button + dialog)
- `apps/web/components/ui/textarea.tsx` — shadcn Textarea (added)
- `apps/web/app/api/feedback/route.ts` — POST handler

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
- Sends `POST callout:RoutingEngine/route` with header `X-Signature-256: sha256=<hex>`
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
| Engine Endpoint | Engine_Endpoint__c | Text(255) | Routing engine URL — written by `lead-routing sfdc deploy` and `pushSettings()` |
| Engine Endpoint | Engine_Endpoint__c | Text(255) | Informational — actual endpoint is in Named Credential |

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

Used in Apex as: `req.setEndpoint('callout:RoutingEngine/route')`

The `<endpoint>` is set to a placeholder in the committed XML. `lead-routing sfdc deploy` patches it to the customer's actual `engineUrl` before running `sf project deploy start`. Additionally, `pushSettings()` (called after OAuth connect) re-syncs the Named Credential via jsforce Metadata API.

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
| `lead-routing init` | Full interactive setup wizard (6 steps) |
| `lead-routing init --dry-run` | Wizard + file generation only — skips Docker start, migrations, health check |
| `lead-routing sfdc deploy` | Bundle + patch + deploy the SFDC package to a Salesforce org (see below) |
| `lead-routing deploy` | Pull latest images, restart containers, run migrations |
| `lead-routing doctor` | Health check: Docker, containers, HTTP endpoints |
| `lead-routing logs [service]` | Stream logs (web / engine / postgres / redis) |
| `lead-routing status` | Show `docker compose ps` output |
| `lead-routing config show` | Print admin secret, app URL, and SFDC client ID from `.env.web` |
| `lead-routing config sfdc` | Update Salesforce Consumer Key + Secret in `.env.web` / `.env.engine` and restart containers |

### `sfdc deploy` Command

`apps/cli/src/commands/sfdc.ts` — `runSfdcDeploy()`

Steps executed in order:
1. Reads `lead-routing.json` via `findInstallDir()` / `readConfig()` — exits with error if not found
2. Checks `sf --version` is installed; if missing, prints install URL + manual deploy command and exits
3. Prompts for Salesforce org alias
4. Runs `sf org login web --alias <alias>` (browser-based OAuth)
5. Copies bundled `sfdc-package/` from CLI dist to `{installDir}/sfdc-package/`
6. **Patches Named Credential XML** — replaces `<endpoint>` with `config.engineUrl` using regex
7. **Patches Remote Site Setting XMLs** — replaces `<url>` in `LeadRouterEngine` with `config.engineUrl` and in `LeadRouterApp` with `config.appUrl`
8. Runs `sf project deploy start --target-org <alias> --source-dir force-app` — deploys all metadata including the `LeadRouterAdmin` permission set
8b. Runs `sf org assign permset --name LeadRouterAdmin --target-org <alias>` — assigns the permission set to the authenticated user so the "Lead Router Setup" app appears in the App Launcher immediately. Non-fatal: if the error contains `Duplicate PermissionSetAssignment` (already assigned on re-deploy), it is treated as success; any other error prints manual instructions.
9. Writes `Routing_Settings__c` org settings — queries for an existing record first (`sf data query`); if found, updates it (`sf data update record --record-id <id>`); otherwise creates it (`sf data create record`). This avoids the `duplicate value found: SetupOwnerId` error on re-deploys (Hierarchy Custom Settings only allow one org-level record).
10. Prints success + next steps (open Salesforce App Launcher → Lead Router Setup)

**Why the permission set is needed**: Deploying a `CustomApplication` via SFDX does not automatically grant any user visibility — the App Launcher only shows apps the authenticated user's profile or a permission set has granted access to. `LeadRouterAdmin.permissionset-meta.xml` grants `applicationVisibilities` for `Lead_Router_Setup` and `Visible` visibility for the `Lead_Router_Setup` tab (`Visible` is required; `Available` only lets the user add it manually and does not satisfy the Lightning App nav bar).

### sfdc-package Bundling

The `sfdc-package/` metadata directory must travel with the CLI npm package:

| Step | Mechanism |
|---|---|
| Local copy | `prepare` npm script copies `../../sfdc-package` → `apps/cli/sfdc-package/` |
| npm publish | `"sfdc-package"` added to `"files"` array in `apps/cli/package.json` |
| tsup build | `onSuccess` hook in `tsup.config.ts` copies `apps/cli/sfdc-package/` → `apps/cli/dist/sfdc-package/` |
| Runtime resolve | `join(__dirname, '..', 'sfdc-package')` from `dist/commands/sfdc.js` |

### `init` Wizard Steps

1. **Prerequisites** — Checks Docker 24+, Docker Compose v2, Node 20+, ports 80 and 443 availability (blocks if in use — required by Caddy), Salesforce CLI `sf` (warning only — non-blocking, needed for `sfdc deploy`)
2. **Configuration** — `@clack/prompts` interactive wizard collecting: App URL, **Engine URL** (public HTTPS URL Salesforce will call — new), SFDC Connected App credentials, DB choice (Docker-managed or BYO URL), Redis choice (Docker-managed or BYO URL), admin email/password, optional Resend API key
3. **Generate files** — Writes to `./lead-routing/`: `docker-compose.yml`, `Caddyfile`, `.env.web`, `.env.engine`, `lead-routing.json`
4. **Start services** — `docker compose pull && docker compose up -d`, then polls PostgreSQL readiness (60s timeout)
5. **Migrations** — Runs Prisma migrate from host against `localhost:5432`, then seeds the first admin `AppUser` via raw SQL
6. **Verify health** — Polls `GET http://localhost:3000/api/health` (web) and `GET http://localhost:3001/health` (engine) via localhost ports (SSL not yet provisioned at this point)

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
│   ├── steps/                      # prerequisites, collect-config, generate-files,
│   │                               #   start-services, run-migrations, verify-health
│   ├── templates/                  # docker-compose.ts, env-web.ts, env-engine.ts
│   └── utils/                      # exec.ts, config.ts, crypto.ts
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

---

## 16. Docker Images

Production Docker images are built for `apps/web` and `apps/engine`. They are published to `ghcr.io/lead-routing/` and pulled by the CLI's Docker Compose configuration.

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
- **Apex callout endpoints must be in `PUBLIC_PREFIXES`**: `proxy.ts` (Next.js middleware) blocks all unauthenticated requests. Salesforce Apex callouts carry no iron-session cookie. Any endpoint called from Apex must be listed in `PUBLIC_PREFIXES`. Currently: `/api/setup/` (status + onboarding-done) and `/api/fields/sync`.
- **Engine MUST be on a public URL**: The Apex trigger calls `callout:RoutingEngine/route` via Named Credential. Salesforce cannot reach `localhost:3001`. For local dev, use `ssh -R 80:localhost:3001 localhost.run` to get a public HTTPS tunnel (URL changes on restart — update `lead-routing.json` `engineUrl` and re-run `sf data update record` + metadata deploy for the Named Credential and Remote Site Setting). For production, the engine should be on a stable public URL.
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

### Salesforce OAuth Connection (Self-Hosted)

The CLI `init` wizard collects OAuth app credentials (`SFDC_CLIENT_ID`, `SFDC_CLIENT_SECRET`, `SFDC_LOGIN_URL`) and writes them to `.env.web`. The actual OAuth authorization — granting the app access to a specific Salesforce org — must happen in the browser via **Settings → Connect Salesforce** in the web app. CLI cannot do browser-based OAuth redirects.

**Callback URL setup**: The Salesforce Connected App must have the exact `SFDC_REDIRECT_URI` (`{APP_URL}/api/auth/callback`) listed in its **Callback URLs**. Without this, Salesforce will reject the OAuth attempt with `redirect_uri_mismatch`.

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

### Customer-Facing Tier UX

- **`QuotaBanner`** (`components/quota-banner.tsx`): shown in dashboard layout when `quotaPercent >= 80`
  - Amber at 80–99%, Red + blocked message at 100%
- **`UpgradeModal`** (`components/upgrade-modal.tsx`): shows Free/Paid/Enterprise tiers with contact CTA
  - `context="seats"` or `context="quota"` changes the header copy
- **Settings page** (`/settings`): shows routing quota progress bar alongside seat usage

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
