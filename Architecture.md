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
16. [AI Routing Assistant](#16-ai-routing-assistant)
17. [Fuzzy & AI-Powered Matching Engine](#17-fuzzy--ai-powered-matching-engine)
18. [Smart Trigger Optimization — Anti-Recursion System](#18-smart-trigger-optimization--anti-recursion-system)
19. [Record Journey — Routing Audit Trail](#19-record-journey--routing-audit-trail)
20. [Scheduled Routes & Search Salesforce Trigger](#20-scheduled-routes--search-salesforce-trigger)
21. [Weighted Round Robin Distribution](#21-weighted-round-robin-distribution)
22. [Run Route Experience](#22-run-route-experience)
23. [Theme & Design System](#23-theme--design-system)
24. [Licensing & Monetization System](#24-licensing--monetization-system)
25. [Bulk API 2.0 System — Scheduled Search at Scale](#25-bulk-api-20-system--scheduled-search-at-scale)
26. [MCP Server (Claude Code Integration)](#26-mcp-server-claude-code-integration)

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
2b. Pre-callout filtering (Trigger Criteria):
    CriteriaEvaluator queries Route_Criteria__c, filters records
    in Apex BEFORE making HTTP callout. No criteria = send all.
        │
        ▼
3. @future callout → POST /route/batch on Engine
   (HMAC-signed, all record fields, up to 100 matching records per call)
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

### 4.1 API Routes (62 endpoints)

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

#### Routing Rules (10 routes)
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
| POST | `/api/rules/[id]/run` | Session | Manual trigger for scheduled routes — records run attempt, updates lastRunAt/lastRunStatus/totalRuns (stub) |
| POST | `/api/rules/[id]/sync-criteria` | Session | Sync trigger conditions to SFDC Route_Criteria__c |
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

#### Users & Licensing (13 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/users` | Session | Paginated user list |
| POST | `/api/users` | Session | Trigger SFDC user sync (4 modes: All, Individual, By Role, By Profile) |
| GET | `/api/users/[id]` | Session | User detail |
| POST | `/api/users/[id]/license` | Session | Grant license |
| POST | `/api/users/[id]/de-license` | Session | Revoke license |
| POST | `/api/users/bulk-license` | Session | Bulk license |
| POST | `/api/users/bulk-delete` | Session | Bulk delete |
| GET | `/api/users/stats` | Session | User metrics (includes breakdown by licensing method + licensed queue count) |
| GET | `/api/users/filters` | Session | Distinct roles and profiles from licensed+active users |
| POST | `/api/users/license-by-role` | Session | License all users matching given roles `{ roles: string[] }` — sets `licensedVia = "role"` |
| POST | `/api/users/license-by-profile` | Session | License all users matching given profiles `{ profiles: string[] }` — sets `licensedVia = "profile"` |
| POST | `/api/users/license-by-custom-field` | Session | License users matching a custom SFDC field `{ fieldName: string }` — sets `licensedVia = "custom_field"` |

#### Teams / Round-Robin (9 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/teams` | Session | List teams with member counts + `distributionType` |
| POST | `/api/teams` | Session | Create team (optional `distributionType`: `"round-robin"` or `"weighted"`, default `"round-robin"`) |
| GET | `/api/teams/[id]` | Session | Team detail + members (includes `weight` per member + `distributionType`) |
| PUT | `/api/teams/[id]` | Session | Update team (accepts `distributionType` changes) |
| POST | `/api/teams/[id]/members` | Session | Add members (by userIds, roles, or profiles) |
| PATCH | `/api/teams/[id]/members/[userId]` | Session | Update member status + optional `weight` |
| DELETE | `/api/teams/[id]/members/[userId]` | Session | Remove member |
| PUT | `/api/teams/[id]/weights` | Session | Bulk update member weights `{ mode: "percentage"|"points", weights: { userId: number } }` — percentage must sum to 100, points must sum to 10 |
| POST | `/api/teams/[id]/reset-pointer` | Session | Reset round-robin pointer |

#### Queues, Fields, Settings (8 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/queues` | Session | List SFDC queues |
| POST | `/api/queues/sync` | Session | Sync queues from SFDC |
| POST | `/api/queues/license` | Session | License queues as routing targets `{ queueIds: string[] }` — sets `isLicensed = true` |
| POST | `/api/queues/de-license` | Session | De-license queues `{ queueIds: string[] }` — sets `isLicensed = false` |
| GET | `/api/fields?object=LEAD` | Session | List field schemas |
| POST | `/api/fields/sync` | X-Sfdc-Org-Id | Sync field schemas (called by Apex) |
| POST | `/api/settings/sync-sfdc` | Session | Push settings to Salesforce |
| POST | `/api/settings/notifications` | Session | Configure webhook notifications |

#### Setup & Onboarding (3 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/setup/status` | X-Sfdc-Org-Id | Check org connection (Apex polling) |
| POST | `/api/setup/onboarding-done` | X-Sfdc-Org-Id | Mark onboarding complete |
| GET | `/api/onboarding/status` | Session | Sidebar checklist progress (5 items with clickable links: Connect CRM → /integrations/salesforce, Deploy Package → /integrations/salesforce, Sync Fields → /integrations/salesforce, License Users → /license-users, Create Routing Rule → /routing-rules/new) |

#### Salesforce Integration Management (6 routes)
| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/integrations/salesforce` | Session | Org integration data for detail page (connection, package, objects, fields) |
| POST | `/api/integrations/salesforce/deploy` | Session | Deploy SFDC package from web app (metadata ZIP, permset, custom settings) |
| GET | `/api/integrations/salesforce/deploy/status` | Session | Poll package deploy status (asyncId-based) |
| GET | `/api/integrations/salesforce/objects` | Session | Get object configuration (Lead/Contact/Account toggles) |
| POST | `/api/integrations/salesforce/objects` | Session | Update object configuration (enable/disable object routing) |
| GET | `/api/integrations/salesforce/status` | Session | Full integration status (connection, package, objects, fields) |
| POST | `/api/integrations/salesforce/disconnect` | Session | Disconnect Salesforce — clears OAuth tokens, package info, objectConfig, resets onboarding |

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
| `/routing-rules` | Route list — card-based layout with filter tabs (All, Real-Time, Scheduled with counts), search by name, stats columns (Total Routed + Paths for realtime, Total Routed + Runs for scheduled). Scheduled routes show a Run (play) button for manual execution via `POST /api/rules/[id]/run`. |
| `/routing-rules/new` | Route Builder canvas — "New Route" dropdown offers Real-Time and Scheduled options; accepts `?type=realtime|scheduled` query param to pre-select route type |
| `/routing-rules/[id]/edit` | Edit existing rule |
| `/routing-rules/[id]/flow` | Flow visualization |
| `/activity` | Routing log viewer (with Route Rule and Team filter dropdowns) |
| `/activity/audit` | Audit log |
| `/activity/failed` | Failed routing logs |
| `/analytics` | Routing analytics dashboard |
| `/license-users` | License Users — 2 tabs (Users, Overview). CRM gate (empty state when no CRM connected). 5 method cards: Individual Users, By Role, By Profile, By Queue, By Custom Field. Each card opens a searchable multi-select dropdown (no modals). Queue licensing treats queues as routing targets, not seat-consuming users. Overview tab shows stats breakdown by licensing method + licensed queue count. |
| `/teams` | Teams management — cards show distribution type badge (Round Robin / Weighted) |
| `/teams/[id]` | Team detail + members (add by individual, Role, or Profile). Distribution type picker (equal vs weighted). Weighted mode: per-member weight sliders, %/pts toggle, distribution bar, equalize button. |
| `/integrations` | Integrations landing page — card grid (Salesforce active, HubSpot/Zoho coming soon) |
| `/integrations/salesforce` | Salesforce detail page — 4 sections: Connection, Package Deploy, Object Config, Field Sync |
| `/settings` | Org settings |
| `/suspended` | Suspension notice |

### 4.3 Route Builder Component Architecture

```
RouteBuilder.tsx (main canvas)
├── StepRegistry.tsx          — Clickable + draggable step sidebar (Filter, Assign, Split, Update Field, Create Task, Match, Default Owner)
├── Config Sheets (side panels):
│   ├── TriggerConfigSheet    — Object type + event + trigger criteria (ConditionBuilder) + dry-run
│   ├── MatchConfigSheet      — Deduplication settings
│   ├── FilterConfigSheet     — Condition groups (AND/OR logic)
│   ├── ActionConfigSheet     — User / Round-Robin / Queue assignment
│   ├── DefaultOwnerConfigSheet — Fallback assignment
│   ├── UpdateFieldConfigSheet — SFDC field update config
│   └── CreateTaskConfigSheet  — SFDC task creation config
├── Condition Builder:
│   ├── ConditionGroup.tsx    — AND group with OR connectors
│   ├── ConditionRow.tsx      — Field + Operator + Value
│   ├── FieldSelect.tsx       — Synced SFDC field dropdown
│   ├── OperatorSelect.tsx    — Context-aware operators by field type
│   └── ValueInput.tsx        — Text / Number / Date / Picklist
└── Types:
    └── types.ts              — RouteBuilderState, MatchConfig, PathAction, PathStepSplit, etc.
```

**Nested Splits**: The canvas supports recursive branching up to 5 levels. Each split creates child paths that can contain further splits. `buildNodesFromState()` recursively positions nodes; `computeEdgesFromState()` generates all connecting edges. Split pill nodes show path counts at each level. `lastActivePathIdRef` tracks which branch receives StepRegistry clicks. Subtree drag moves all descendant nodes together.

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
  paths: RoutePath[]          // Each path = filter conditions + assignment action + nested steps
  defaultOwner: DefaultOwner | null
}

// Paths contain recursive step arrays:
type PathStep = PathStepFilter | PathStepAssign | PathStepUpdateField | PathStepCreateTask | PathStepSplit
interface PathStepSplit { type: 'split'; paths: RoutePath[] }  // Recursive — up to 5 levels
```

### 4.4 Utility Libraries (lib/)

| File | Purpose |
|------|---------|
| `auth.ts` | `getOrgIdFromHeaders()`, `getActorFromHeaders()` — read proxy-injected headers |
| `session.ts` | SessionData interface, `getSession()`, `requireSession()` (iron-session) |
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
| `router.ts` | Core routing logic — new-style (branches) + legacy modes; branches on `distributionType` for equal vs weighted round-robin |
| `evaluator.ts` | Condition evaluation engine (20 operators, AND/OR groups) |
| `cache.ts` | In-memory rule cache, `loadAllRules()`, pub/sub listener |
| `queue.ts` | BullMQ queue + worker for retry jobs |
| `batch-queue.ts` | BullMQ queue `routing-batch` + parallel worker (concurrency 10, rate limit 20/sec) |
| `redis.ts` | ioredis singleton (`maxRetriesPerRequest: null` for BullMQ) |
| `sfdc.ts` | jsforce connection caching, SFDC ID lookups |
| `webhook.ts` | Fire-and-forget notification webhook (3s timeout) |
| `idempotency.ts` | Single + bulk Redis idempotency (`claimIdempotencyKey` + `claimIdempotencyKeys` pipeline) |
| `round-robin.ts` | Equal + weighted round-robin: `getNextMember()` (equal) and `getNextWeightedMember()` (GCD-normalized, deficit-based interleaving) — atomic Redis Lua script |
| `middleware/validate-signature.ts` | HMAC-SHA256 verification |
| `lib/crypto.ts` | AES-256-GCM decryption (`decryptField`) — reads `APP_SECRET` env var |
| `lib/ai-client.ts` | Multi-provider AI similarity client for fuzzy company name matching |
| `lib/fuzzy.ts` | Levenshtein, Soundex, Double Metaphone, company name normalization, abbreviation dictionary (~85 entries), `fuzzyCompanyMatch()` cascading matcher |
| `lib/alias-cache.ts` | Three-layer alias cache: L1 in-memory LRU (1000/org, 1hr TTL) → L2 Redis hash (24hr) → L3 Postgres `company_aliases` table (permanent) |

### 5.4 Condition Operators (23)

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
| `fuzzy_equals` | Levenshtein similarity >= 0.8 (fuzzy string match) |
| `sounds_like` | Soundex + Double Metaphone phonetic match |
| `similar_to` | Tiered: fuzzy → alias cache → AI → fallback (similarity >= 0.7) |

### 5.5 Assignment Resolution

| Type | Mechanism |
|------|-----------|
| **USER** | Lookup `sfdcUserId` from `users` table → `updateOwner()` |
| **ROUND_ROBIN** | Equal: Atomic Redis Lua `INCR + modulo` → next team member. Weighted: GCD-normalized deficit-based interleaved slots → Lua `INCR + modulo` over virtual slot array → `updateOwner()` |
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
| `lead-routing init` | Interactive 7-step deployment wizard |
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
     engineWebhookSecret, internalApiKey

Step 4: Generate Files (locally)
  ├─ docker-compose.yml
  ├─ Caddyfile
  ├─ .env.web
  ├─ .env.engine
  └─ lead-routing.json

Step 5: Check Remote Prerequisites ──────────────▶ Verify Docker (auto-install)
                                                   Free ports 80/443
                                                   Stop conflicting services

Step 6: Upload Files + Start Services ───────────▶ SFTP 5 files to remoteDir
                                                   docker compose pull + up
                                                   (migrations + seed run inside
                                                    web container on startup)

Step 7: Verify Health
  ├─ Poll GET {appUrl}/api/health (24 × 5s)
  └─ Poll GET {engineUrl}/health

  ▸ Note: "Next: Connect Salesforce" — directs user
    to Integrations → Salesforce in the web UI
    (SFDC deploy moved out of CLI init)
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
| `RoutingEngineCallout` | `@future(callout=true)` — queries Route_Criteria__c, filters records via CriteriaEvaluator, builds batch payload, signs with HMAC, POSTs to `/route/batch`. No criteria = send all (backward compatible). |
| `RoutingPayloadBuilder` | `build()` — single-record payload (legacy); `buildBatch()` — batch payload with `records[]` array |
| `CriteriaEvaluator` | Evaluates Route_Criteria__c against SObject records. 18+ operators (equals, contains, gt, lt, before, after, within_last, includes, etc.). AND within group, OR between groups. |
| `CriteriaEvaluatorTest` | Full test coverage: all operators, AND/OR groups, null handling, empty criteria pass-through |
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

**`Route_Criteria__c`** (Custom Object — Pre-Callout Filtering):

| Field | Type | Purpose |
|-------|------|---------|
| `Rule_Id__c` | Text(30) | Maps to RoutingRule.id |
| `Object_Type__c` | Text(10) | LEAD/CONTACT/ACCOUNT |
| `Event_Type__c` | Text(10) | INSERT/UPDATE/BOTH |
| `Group_Id__c` | Text(40) | AND/OR grouping |
| `Field_Name__c` | Text(255) | SFDC field API name |
| `Operator__c` | Text(30) | equals, gt, contains, etc. |
| `Value__c` | LongText(32768) | Comparison value |
| `Sort_Order__c` | Number | Display order |
| `Is_Active__c` | Checkbox | Mirrors rule ACTIVE status |

**`CriteriaEvaluator.cls`** — evaluates Route_Criteria__c against SObject records inside `@future` context. AND within group, OR between groups. 18 operators: equals, not_equals, contains, not_contains, starts_with, gt, lt, gte, lte, before, after, within_last, includes, excludes, is_blank, is_not_blank, is_true, is_false. Uses `record.get(fieldName)` for dynamic field access.

**`RoutingEngineCallout.sendAsync()`** — updated to query active Route_Criteria__c, filter records through CriteriaEvaluator before HTTP callout. No criteria = all records sent (backward compatible). +1 SOQL query.

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
| Permission Set | `LeadRouterAdmin` | Access to setup app + tab + CRUD/FLS on Route_Criteria__c |

---

## 8. Shared Packages

### 8.1 @lead-routing/db (packages/db)

Prisma ORM wrapper exporting singleton client + generated types.

**Exports:**
- `prisma` — PrismaClient singleton (dev-mode hot-reload via globalThis)
- All Prisma-generated types
- `PLAN_LIMITS` / `getPlanLimits()` — plan-specific quotas
- `RULES_INVALIDATE_CHANNEL` — Redis channel constant

**Migrations (6+):**
1. `20260101000000_init` — Initial schema
2. `20260223000000_add_routing_log_dismissed` — Add dismissedAt
3. `20260224000000_add_org_notification_webhook` — Add notificationWebhookUrl
4. `20260227000000_self_hosted_schema_updates` — SFDC columns nullable, app_users/invites, plan/quota
5. `20260308100000_route_match_config` — Route Builder tables (branches, match config, default owner)
6. Various: `add_cooldown_stamp_status`, `add_decision_trace`, `add_license_fields`, `add_distribution_type` — Anti-recursion enums, record journey trace, license fields, weighted round robin

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
| `sfdc-api.ts` | `SalesforceApi` class — REST API for metadata deploy, permset assignment, custom settings (shared with CLI) |
| `zip-source.ts` | `zipSourcePackage()` — creates SFDC metadata ZIP from source package directory |

---

## 9. Database Schema

### 9.1 Entity Relationship Diagram

```
Organization (1)
  │
  ├──▶ AppUser (*)           — Dashboard login users
  ├──▶ Invite (*)            — Registration invites
  ├──▶ User (*)              — Synced SFDC users (licensedVia tracks licensing method)
  ├──▶ RoundRobinTeam (*)    — distributionType: "round-robin" | "weighted"
  │      └──▶ TeamMember (*) — Links User ↔ Team (weight: Int, default 1)
  ├──▶ SfdcQueue (*)         — isLicensed: whether queue is a licensed routing target
  ├──▶ FieldSchema (*)
  ├──▶ RoutingRule (*)
  │      ├──▶ RuleCondition (*)     — Legacy conditions
  │      ├──▶ TriggerCondition (*)  — Pre-callout filter criteria (synced to SFDC Route_Criteria__c)
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
- Integration tracking: `packageDeployedAt`, `packageDeployId`, `packageVersion`, `objectConfig` (JSON), `fieldsSyncedAt`

**User** — Synced SFDC users (routing recipients)
- isLicensed, isActive, lastRoutedAt
- `licensedVia` (String?) — tracks how the user was licensed: `"individual"`, `"role"`, `"profile"`, `"custom_field"`, or null (legacy/unknown)

**SfdcQueue** — Synced Salesforce queues
- `isLicensed` (Boolean) — whether the queue is a licensed routing target; queues do NOT consume user seats

**RoutingRule** — Routing logic definition
- Legacy: single assignmentType + conditions
- Route Builder: branches[] + matchConfig? + defaultOwner*
- Trigger criteria: triggerConditions[] (pre-callout filtering, synced to SFDC Route_Criteria__c)

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
2. Decrypt iron-session → validate `session.orgId`
3. Check org suspension via Redis
4. Inject headers: `x-org-id`, `x-user-id`, `x-user-name`
5. Continue to route handler

---

## 11. Routing Pipeline

### 11.0 Pre-Callout Filtering (Trigger Criteria)

Before any record reaches the routing engine, the Apex `@future` method evaluates trigger criteria:

```
Records enter @future(callout=true)
    │
    ▼
Query Route_Criteria__c for all ACTIVE rules
matching this objectType + eventType
    │
    ├─ No criteria exist → send ALL records (backward compatible)
    │
    ├─ Criteria exist → CriteriaEvaluator filters:
    │   - AND within same groupId
    │   - OR between different groupIds
    │   - OR between different ruleIds
    │   - 18+ operators (equals, contains, gt, lt, before, after, within_last, etc.)
    │
    ├─ Records match ≥1 rule's criteria → POST /route/batch
    └─ No records match → skip callout entirely (save HTTP call)
```

Criteria are defined per-route in the Route Builder UI and synced to Salesforce via `POST /api/rules/:id/sync-criteria`.

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
│   ├─ SOQL: find Account │──▶ onAccountMatch: ASSIGN_TO_OWNER / ASSIGN_CUSTOM / SKIP
│   └─ Company Name Match │──▶ STRICT / FUZZY / AI_SMART (see §17)
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

### 11.1.1 Nested Splits (Recursive Branching)

Branches can contain nested split steps, enabling recursive decision trees up to 5 levels deep. Each branch's `steps` array may include a `split` step type, which itself contains child paths with their own steps (including further nested splits).

```
Rule has branches[] with nested splits
    │
    ▼
┌─────────────────────────────────┐
│   BRANCH EVALUATION             │
│   For each branch (priority):   │
│   ├─ Evaluate conditions        │
│   └─ If match:                  │
│       executeSteps(steps):      │
│       ├─ filter → evaluate      │
│       ├─ assign → resolve       │──▶ updateOwner()
│       ├─ update_field → SFDC    │
│       ├─ create_task → SFDC     │
│       └─ split → recurse:      │
│           For each child path:  │
│           ├─ Evaluate conditions│
│           └─ executeSteps(...)  │──▶ (recursive)
└─────────────────────────────────┘
```

**Engine execution** (`router.ts`): The `executeSteps()` function processes a branch's step array sequentially. When it encounters a `split` step, it iterates the split's child paths in priority order, evaluates each path's conditions, and recursively calls `executeSteps()` on the first matching path. This enables arbitrarily deep decision trees within a single route.

**Data model**: The `PathStepSplit` type in `types.ts` contains `paths: RoutePath[]`, where each `RoutePath` has its own `steps: PathStep[]`. The `PathStep` union type includes `filter`, `assign`, `update_field`, `create_task`, and `split`. Tree helper functions (`findPathById`, `updatePathById`, `removePathById`, `flattenAllPaths`, `flattenAllSplits`) operate recursively across the entire tree.

**Canvas layout** (`RouteBuilder.tsx`): `buildNodesFromState()` recursively positions nested split branches. Each split level adds a "split pill" node (small rounded badge showing path count). `computeEdgesFromState()` generates edges connecting all nodes in the tree. Subtree drag moves all descendant nodes together.

**Serialization** (`builder-to-rule.ts`): `builderToApiBody()` and `apiRuleToBuilderState()` preserve nested `path.steps` arrays through save/reload cycles. Previously steps were silently lost on save.

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

**Equal Round Robin** (`distributionType: "round-robin"`):
```
Redis Lua Script (atomic):
  INCR rr:{orgId}:{teamId}:pointer
  RETURN (value - 1) % memberCount

Members: sorted by createdAt ASC, filtered to ACTIVE status
Pointer: persistent across requests, reset via API
```

**Weighted Round Robin** (`distributionType: "weighted"`):
```
1. Normalize weights by GCD  (e.g. [40,40,20] → GCD=20 → [2,2,1])
2. Build interleaved slot array via deficit-based algorithm:
   - For each slot position, pick the member most "overdue" (highest deficit)
   - Deficit = (idealFraction * position) - filledSoFar
   - Result: [A,B,A,B,C] instead of clustered [A,A,B,B,C]
3. Same atomic Redis Lua script, but over virtual slots:
   INCR wrr:{orgId}:{teamId}:pointer
   RETURN (value - 1) % totalSlots → maps to member

Separate Redis key prefix (wrr: vs rr:) — switching distribution
type does not corrupt the other mode's pointer.
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
| Key | `rr:{orgId}:{teamId}:pointer` | Equal round-robin pointer (Lua atomic INCR) |
| Key | `wrr:{orgId}:{teamId}:pointer` | Weighted round-robin pointer (Lua atomic INCR over virtual slot array) |
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
CLI     ──── SSH + SFTP ───────▶ VPS           (sfdc deploy command)
Web App ──── REST API ────────▶ Salesforce    (deploy metadata via /api/integrations/salesforce/deploy)
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

18. **`useSearchParams()` requires a Suspense boundary in Next.js 16** — any client component calling `useSearchParams()` must be wrapped in `<Suspense>`. Without it, the page errors during static generation. The Integrations Salesforce detail page uses an inner component wrapped in Suspense to read the `?connected=1` query param.

19. **OAuth callback redirect target** — SFDC OAuth callback (`/api/auth/sfdc/callback`) redirects to `/integrations/salesforce?connected=1` (not `/dashboard`). The Integrations page reads this param to show a success toast.

20. **SFDC package deploy moved from CLI to web app** — `lead-routing init` no longer deploys the Salesforce package (reduced from 8 to 7 steps). Users deploy via the Integrations → Salesforce page in the web UI. The `SalesforceApi` class and `zipSourcePackage()` are shared from `packages/sfdc` for use by both CLI (`lead-routing sfdc deploy`) and web app (`/api/integrations/salesforce/deploy`).

21. **Sidebar "Integrations" nav item** — Added in the SETUP section with a Plug icon, linking to `/integrations`.

22. **Salesforce custom objects require `enableSharing`, `enableBulkApi`, and `enableStreamingApi` to all be enabled or disabled together** — setting only one causes a cryptic deploy validation error.

23. **`zipSourcePackage` must include `-meta.xml`-only types in `package.xml`** — PermissionSet, NamedCredential, RemoteSiteSetting, CustomTab, CustomApplication files that only have a `-meta.xml` (no companion class file) were being skipped in package.xml manifest generation. Salesforce silently omits them from the deploy, resulting in fewer components than expected (e.g. 41 vs 47). Fixed by using `entry.name.split('.')[0]` for member name extraction.

24. **Route_Criteria__c fields not queryable without PermissionSet FLS access** — even if the custom object and fields are deployed successfully, SOQL queries return empty results unless the running user has field-level security granted via the `LeadRouterAdmin` permission set. The permission set must be both deployed AND assigned to the integration user.

25. **License server secrets are in `wrangler.toml` `[vars]`** — must be moved to `wrangler secret put` for production. D1 binding and Stripe keys are currently in plaintext vars.

26. **Ed25519 public key is hardcoded in `verify-license.js`** — the offline JWT verification script bakes in the public key. If the signing key rotates on the license server, Docker images must be rebuilt and redeployed to pick up the new public key.

27. **`yaml.dump` can break `docker-compose.yml` formatting** — Python's `yaml.dump` re-serializes the entire file, potentially reordering keys and stripping comments. Use Python string replacement (e.g., `re.sub`) for targeted edits to docker-compose files.

28. **Marketing site at `/root/marketing-site/` is independent from `/root/lead-routing/`** — safe to wipe `lead-routing/` without losing the marketing site. They share the same Caddy instance but are separate directory trees.

---

## 16. AI Routing Assistant

### 16.1 Architecture Overview

The AI Routing Assistant follows a **BYOK (Bring Your Own Key)** model. Customers provide their own LLM API key via the web app settings page. The web app acts as an intermediary between the user and the LLM using a tool-use pattern — the LLM receives a set of org-scoped query tools it can invoke to answer questions about routing performance, rule configuration, and team workload. The LLM never gets direct database access; all data retrieval is mediated through server-side tool functions that enforce org isolation and return sanitized results.

```
User ──── Chat UI ────▶ Web App API ────▶ LLM Provider
                            │                   │
                            │              tool_use calls
                            │                   │
                            ▼                   ▼
                      Tool Dispatcher ◀──── tool invocations
                            │
                            ▼
                     Prisma Queries (org-scoped)
                            │
                            ▼
                       PostgreSQL
```

### 16.2 Multi-Provider Support

Four LLM providers are supported, each using its native SDK:

| Provider | SDK | Models |
|----------|-----|--------|
| **Claude** | `@anthropic-ai/sdk` | claude-sonnet-4-20250514, etc. |
| **OpenAI** | `openai` | gpt-4o, gpt-4o-mini, etc. |
| **Gemini** | `@google/genai` | gemini-2.0-flash, etc. |
| **Custom** | `openai` (compatible) | Any OpenAI-compatible endpoint |

The Custom provider reuses the OpenAI SDK with a user-supplied `baseURL` and optional custom headers, supporting providers like Ollama, Together, Groq, and Azure OpenAI.

Provider selection and API key configuration are managed in the AI settings page. The chat endpoint (`/api/ai/chat`) reads the org's configured provider and dispatches to the appropriate SDK handler, normalizing the tool-use protocol across providers.

### 16.3 Security

**API Key Encryption:** Customer API keys are encrypted at rest using AES-256-GCM with a key derived from the instance's `APP_SECRET` via scrypt. The `encryptField()` and `decryptField()` functions in `apps/web/lib/crypto.ts` handle encryption and decryption. Encrypted keys are stored in the `Organization.aiApiKey` database field.

**Org Isolation:** Every tool query is scoped to the authenticated user's `orgId`. There is no mechanism for a tool call to access data from another organization.

**No Direct DB Access:** The LLM only sees tool definitions (name, description, parameters) and tool results. It cannot execute arbitrary queries. All data access goes through predefined Prisma query functions that return structured, bounded result sets.

### 16.4 Tool-Use Architecture

The assistant exposes 21 org-scoped query tools covering all 21 database tables. Tool definitions (JSON Schema parameters + descriptions) are sent to the LLM as part of the system prompt. When the LLM returns a `tool_use` response, the server-side dispatcher invokes the corresponding Prisma query function, passes the result back to the LLM, and the LLM produces a natural-language answer. Sensitive fields (OAuth tokens, API keys, password hashes, session tokens) are excluded via explicit Prisma `select` clauses.

| Tool | Purpose |
|------|---------|
| `query_routing_logs` | Filter routing logs by status, rule, assignee, pathLabel, branchId, and/or date range |
| `get_branch_performance` | Success/fail/unmatched aggregation per branch (RoutingLog grouped by branchId) |
| `get_rule_performance` | Success/fail/unmatched aggregation per rule |
| `get_team_workload` | Assignment counts per team member (grouped by team) |
| `get_conversion_metrics` | Conversion rate and pipeline value by rule |
| `get_trend_data` | Daily aggregate time series for charting |
| `list_rules` | List all routing rules with status, priority, object type, branch/condition counts |
| `get_assignee_stats` | Assignment counts per individual assignee (user or queue) across all rules |
| `explain_rule` | Full rule configuration with branches, conditions, and teams |
| `get_routing_timeline` | Ordered event history for a specific Salesforce record ID |
| `list_teams` | Round-robin teams with members, weights, and active/paused status |
| `list_users` | Salesforce users — licensed status, department, last routed |
| `query_audit_logs` | Configuration change history (rule edits, licensing, team changes) |
| `list_queues` | Salesforce queues synced for assignment |
| `query_company_aliases` | Fuzzy company name match cache with confidence scores |
| `list_fields` | Available Salesforce fields per object type with picklist values |
| `get_org_settings` | Organization config — plan, quotas, SFDC connection, package status (secrets stripped) |
| `list_app_users` | Dashboard login users — role, email, active status (passwords stripped) |
| `list_invites` | Pending/accepted/expired invitations (tokens stripped) |
| `get_billing_info` | Billing details — entity name, GSTIN, address |
| `list_sessions` | Active login sessions — user, expiry (session IDs stripped) |

Each tool function lives in `apps/web/lib/ai/queries.ts` and accepts `orgId` as a mandatory first parameter. The dispatcher in `apps/web/lib/ai/tools.ts` maps tool names to query functions and validates input parameters before execution.

### 16.5 Plan Gating & Navigation Flow

Access to the AI assistant is gated by plan and configuration state:

| State | Behavior |
|-------|----------|
| **FREE plan** | `PaywallOverlay` displayed — upgrade required |
| **PAID plan, no API key configured** | `ConnectProvider` panel shown — user must add their LLM API key |
| **PAID plan, API key configured** | Full chat interface with `ChatWindow` |

This three-state flow is handled entirely client-side on the `/ai-assistant` page, reading the org's plan and AI configuration status.

**Settings ↔ Chat Navigation:**

The AI Settings page (`/settings/ai`) and Chat page (`/ai-assistant`) are cross-linked for a seamless setup-to-usage flow:

1. `/ai-assistant` with no provider configured → shows empty state with "Go to AI Settings" button → navigates to `/settings/ai`
2. `/settings/ai` → user connects a provider (enters API key, selects model) → "Open Chat" button appears → navigates to `/ai-assistant`
3. Chat header displays a clickable provider/model badge (e.g. "Claude · claude-sonnet-4-20250514") that links back to `/settings/ai` for quick reconfiguration

### 16.6 Key Files

| File | Purpose |
|------|---------|
| `apps/web/app/api/ai/chat/route.ts` | Chat endpoint; provider-specific LLM handlers with tool-use loop |
| `apps/web/app/api/settings/ai/route.ts` | AI settings CRUD (provider, model, encrypted API key) |
| `apps/web/lib/ai/tools.ts` | Tool definitions (JSON Schema) and dispatcher |
| `apps/web/lib/ai/queries.ts` | Org-scoped Prisma query functions for each tool |
| `apps/web/lib/crypto.ts` | `encryptField()` / `decryptField()` — AES-256-GCM with scrypt |
| `apps/web/app/(dashboard)/ai-assistant/page.tsx` | Dashboard page with plan gating logic |
| `apps/web/components/ai-chat/ChatWindow.tsx` | Main chat interface component |
| `apps/web/components/ai-chat/ConnectProvider.tsx` | API key configuration panel |
| `apps/web/components/ai-chat/MessageBubble.tsx` | Message rendering with `remark-gfm` for GFM tables and custom `pre` renderer for chart blocks |
| `apps/web/components/ai-chat/ChartBlock.tsx` | Chart renderer (bar, line, area, pie) using recharts |
| `apps/web/components/ai-chat/SuggestionGrid.tsx` | Starter prompt suggestions |
| `apps/web/components/ai-chat/PaywallOverlay.tsx` | Upgrade prompt for free-plan users |
| `apps/web/app/(dashboard)/settings/ai/page.tsx` | AI provider settings page (connect/edit/disconnect providers) |
| `apps/web/app/(dashboard)/settings/layout.tsx` | Settings layout with tabs (General, Webhooks, AI Assistant) |
| `apps/web/lib/ai/tools.test.ts` | Unit tests for tool dispatcher and query functions |

### 16.7 Charts & Visualizations

The AI assistant can output interactive charts inline in chat responses. When the LLM determines a visualization would help (trends, comparisons, distributions), it outputs a fenced code block with language `chart` containing a JSON spec. The frontend's `MessageBubble` component intercepts these via a custom ReactMarkdown `pre` renderer and renders them using recharts.

**Chart Spec Format:**
```json
{
  "type": "bar | line | area | pie",
  "title": "Chart Title",
  "data": [{"label": "A", "value": 10}, ...],
  "xKey": "label",
  "yKeys": ["value"],
  "colors": ["#7C3AED", ...],  // optional
  "stacked": false              // optional
}
```

**Supported Chart Types:**
| Type | Use Case | recharts Component |
|------|----------|-------------------|
| `bar` | Comparisons (rule performance, assignee workload) | `BarChart` + `Bar` |
| `line` | Trends over time (daily routing volume) | `LineChart` + `Line` |
| `area` | Volume over time with fill | `AreaChart` + `Area` |
| `pie` | Proportions (status distribution) | `PieChart` + `Pie` |

Charts render inside a card container with responsive width and 300px height. Default color palette is purple-themed (#7C3AED, #2563EB, #059669, #D97706, #DC2626). Multiple yKeys produce grouped/stacked charts with a legend.

**Markdown Rendering:** Uses `react-markdown` with `remark-gfm` plugin for GFM table support. Custom CSS styles in `.ai-markdown` class (globals.css) handle typography since `@tailwindcss/typography` is incompatible with the Tailwind v4 + pnpm monorepo setup.

## 17. Fuzzy & AI-Powered Matching Engine

### 17.1 Overview

The routing engine supports three levels of string and company name matching: exact, fuzzy (algorithmic), and AI-powered. This manifests in two ways:

1. **Condition operators** — Three new operators (`fuzzy_equals`, `sounds_like`, `similar_to`) available on TEXT-type fields in the condition builder, evaluated in `evaluator.ts`.
2. **Company name matching** — A dedicated matching mode in the Match step (`router.ts`) that queries Salesforce for candidate accounts and applies STRICT, FUZZY, or AI_SMART comparison.

### 17.2 Fuzzy Algorithms (`lib/fuzzy.ts`)

The core algorithmic library provides:

- **`normalizeCompanyName()`** — Strips legal suffixes (Inc, LLC, Corp, Ltd, GmbH, etc.), lowercases, removes punctuation and extra whitespace
- **`levenshtein(a, b)`** — Standard Levenshtein distance, returns similarity ratio 0.0–1.0
- **`soundex(s)`** — Classic Soundex encoding (4-char code)
- **`doubleMetaphone(s)`** — Double Metaphone algorithm returning primary and alternate encodings
- **Abbreviation dictionary** — ~85 entries mapping common abbreviations to full names (e.g. "IBM" to "International Business Machines", "HP" to "Hewlett Packard")
- **`fuzzyCompanyMatch(a, b)`** — Cascading matcher:
  1. Exact normalized match → true
  2. Abbreviation dictionary lookup → true
  3. Levenshtein similarity >= 0.85 → true
  4. Soundex match → true
  5. Double Metaphone match (primary or alternate) → true
  6. Otherwise → false

### 17.3 Condition Operators (Evaluator)

The `evaluator.ts` module (now async) supports three fuzzy operators on TEXT fields:

| Operator | Algorithm | Threshold | Async |
|----------|-----------|-----------|-------|
| `fuzzy_equals` | Levenshtein distance | similarity >= 0.8 | No |
| `sounds_like` | Soundex + Double Metaphone | Either phonetic code matches | No |
| `similar_to` | Tiered resolution chain | varies (see below) | Yes |

**`similar_to` resolution chain:**
1. Exact normalized match → true
2. Abbreviation dictionary hit → true
3. Fuzzy similarity >= 0.85 → true
4. Alias cache lookup (L1 → L2 → L3) → cached result
5. AI provider call (if configured) → cache result, return
6. Fallback: fuzzy similarity >= 0.7 → true

### 17.4 AI Similarity Client (`lib/ai-client.ts`)

Multi-provider AI client used by the `similar_to` operator and AI_SMART company matching mode.

- **`resolveCompanySimilarity(orgId, companyA, companyB)`** — Returns `{ isSimilar: boolean, confidence: number }` or `null` on any failure
- **`isAIConfigured(orgId)`** — Quick check if org has a configured AI provider
- **Config caching** — Org AI config (provider, decrypted key, model, baseUrl, custom headers) cached in-memory with 5-minute TTL
- **Rate limiting** — 10 calls/sec per org (in-memory sliding window); excess returns `null`
- **Providers** — Claude (Anthropic API), OpenAI, Gemini, Custom (OpenAI-compatible with custom baseUrl/headers)
- **Graceful fallback** — All errors caught and return `null`; AI failure never breaks routing
- **Cost control** — `max_tokens: 50`, JSON-only prompt

### 17.5 Three-Layer Alias Cache (`lib/alias-cache.ts`)

Caches AI similarity results to avoid redundant LLM calls:

| Layer | Storage | Capacity / TTL | Lookup |
|-------|---------|----------------|--------|
| **L1** | In-memory LRU Map | 1000 entries/org, 1hr TTL | `checkAliasCache()` checks first |
| **L2** | Redis hash (`alias:{orgId}`) | 24hr TTL | Falls through from L1 miss |
| **L3** | Postgres `company_aliases` table | Permanent | Falls through from L2 miss |

On AI result, `cacheAliasResult()` writes to all three layers simultaneously. The `CompanyAlias` model stores `orgId`, `nameA`, `nameB`, `isSimilar`, `confidence`, and `source` (AI provider used).

### 17.6 Encryption (`lib/crypto.ts`)

Decrypt-only counterpart to the web app's `encryptField()`. Uses AES-256-GCM with a key derived from `APP_SECRET` via scrypt (salt: `"lead-routing-field-enc"`, keylen: 32). The engine only decrypts (never encrypts) AI API keys stored in the database.

### 17.7 Company Name Matching in `runMatcher()`

The Match step in `router.ts` includes company name matching as the 4th check (after email, contact, domain/phone matching). Controlled by two `RouteMatchConfig` fields:

- **`matchCompanyName`** (boolean, default `false`) — enables/disables company name matching
- **`fuzzyMatchMode`** (string, default `"STRICT"`) — one of `"STRICT"`, `"FUZZY"`, or `"AI_SMART"`

**Flow:**
1. Extract the `Company` field from the incoming record
2. Query Salesforce for candidate Accounts using `SOQL LIKE '%<first 5 chars>%' LIMIT 20`
3. For each candidate, apply the configured matching mode:
   - **STRICT** — exact match after `normalizeCompanyName()` (strips suffixes like Inc/LLC/Corp, lowercases, removes punctuation)
   - **FUZZY** — `fuzzyCompanyMatch()` cascading matcher (Levenshtein >= 0.8, Soundex, Double Metaphone, abbreviation dictionary)
   - **AI_SMART** — alias cache lookup (L1 → L2 → L3). On cache miss, calls org's configured LLM. On AI failure/unconfigured, falls back to FUZZY
4. First matching candidate returns `{ type: "ACCOUNT", recordId, ownerId }` which feeds into the existing `onAccountMatch` handler (ASSIGN_TO_OWNER / ASSIGN_CUSTOM / SKIP)

### 17.8 Database Changes

- **`CompanyAlias` model** — New table `company_aliases` with fields: `id`, `orgId`, `nameA`, `nameB`, `isSimilar`, `confidence`, `source`, `createdAt`. Indexed on `(orgId, nameA, nameB)` for fast lookups.
- **`RouteMatchConfig` additions** — `matchCompanyName` (Boolean) and `fuzzyMatchMode` (String) fields added to configure per-route company matching behavior.

### 17.9 Web App UI

- **`MatchConfigSheet.tsx`** — Company name matching toggle with mode selector (STRICT / FUZZY / AI_SMART) in the Route Builder Match step configuration
- **`OperatorSelect.tsx`** — `similar_to` operator displays an "AI" badge to indicate it may use an AI provider
- **`operators.ts`** — Three new operators (`fuzzy_equals`, `sounds_like`, `similar_to`) added to the TEXT operator type
- **`types.ts`** — `FuzzyMatchMode` type exported (`"STRICT" | "FUZZY" | "AI_SMART"`)
- **`builder-to-rule.ts`** — Bidirectional conversion updated to include `matchCompanyName` and `fuzzyMatchMode` fields
- **`/api/rules` and `/api/rules/[id]/clone`** — Rule create and clone endpoints accept and persist fuzzy fields

### 17.10 Key Files

| File | Purpose |
|------|---------|
| `apps/engine/src/lib/fuzzy.ts` | Levenshtein, Soundex, Double Metaphone, normalization, abbreviation dict, `fuzzyCompanyMatch()` |
| `apps/engine/src/lib/crypto.ts` | `decryptField()` — AES-256-GCM decryption using `APP_SECRET` |
| `apps/engine/src/lib/ai-client.ts` | `resolveCompanySimilarity()`, `isAIConfigured()` — multi-provider AI similarity |
| `apps/engine/src/lib/alias-cache.ts` | `checkAliasCache()`, `cacheAliasResult()` — three-layer alias cache (L1/L2/L3) |
| `apps/engine/src/evaluator.ts` | Async condition evaluator — added `fuzzy_equals`, `sounds_like`, `similar_to` operators |
| `apps/engine/src/router.ts` | `runMatcher()` — company name matching logic (STRICT/FUZZY/AI_SMART) |
| `apps/engine/src/cache.ts` | `CachedMatchConfig` — includes `matchCompanyName` and `fuzzyMatchMode` fields |
| `packages/db/prisma/schema.prisma` | `CompanyAlias` model, `matchCompanyName`/`fuzzyMatchMode` on `RouteMatchConfig` |
| `apps/web/lib/operators.ts` | Fuzzy operators added to TEXT type |
| `apps/web/components/route-builder/config/MatchConfigSheet.tsx` | Company name matching UI with mode selector |
| `apps/web/components/route-builder/types.ts` | `FuzzyMatchMode` type definition |
| `apps/web/lib/builder-to-rule.ts` | Bidirectional conversion for fuzzy fields |
| `apps/web/components/condition-builder/OperatorSelect.tsx` | AI badge on `similar_to` operator |
| `apps/web/app/api/rules/route.ts` | Rule create — fuzzy fields |
| `apps/web/app/api/rules/[id]/clone/route.ts` | Rule clone — fuzzy fields |

### 17.11 Test Coverage

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `apps/engine/src/lib/fuzzy.test.ts` | 79 | Levenshtein, Soundex, Metaphone, normalization, abbreviation dict, cascading matcher |
| `apps/engine/src/lib/crypto.test.ts` | 6 | Round-trip encryption/decryption, error cases |
| `apps/engine/src/lib/ai-client.test.ts` | 16 | All providers, error handling, rate limiting, config caching |
| `apps/engine/src/lib/alias-cache.test.ts` | 11 | L1/L2/L3 cache layers, write-through, TTL expiry |
| `apps/engine/src/evaluator.test.ts` | 81 total (13 new) | Fuzzy operators: `fuzzy_equals`, `sounds_like`, `similar_to` |
| `apps/engine/src/router.test.ts` | 72 total (10 new) | Company name matching: STRICT, FUZZY, AI_SMART modes |

**Total new tests added: ~50**

---

## §18 Smart Trigger Optimization — Anti-Recursion System

### 18.1 Problem

When the engine routes a record (INSERT event), it updates `OwnerId` via REST API. This fires Salesforce's `after update` trigger, sending the record **back** to the engine as an UPDATE event — wasted callout, confusing activity log, potential infinite loop.

### 18.2 Four-Layer Defense

#### Layer 1 — Smart Flag Sync (`apps/web/lib/sync-routing-flags.ts`)

When rules are created/updated/deleted/toggled, `syncRoutingFlags(orgId)` queries all ACTIVE rules, computes which `{Object}_{Event}_Enabled__c` flags should be true, and writes them to `lrt__Routing_Settings__c` in Salesforce.

- Called from: POST/PUT/DELETE `/api/rules`, clone, status toggle, and deploy route
- On fresh deploy with no rules, all flags = `false` (no unnecessary callouts)
- Fire-and-forget with `console.warn` on failure

#### Layer 2 — Routing Action Field Stamp (LeanData pattern)

Custom field `Routing_Action__c` (Text 255) added to Lead, Contact, Account in the managed package (`lrt__Routing_Action__c` in subscriber orgs).

**Engine side** (`packages/sfdc/src/update-owner.ts`): Sets `lrt__Routing_Action__c = "assigned:<ISO timestamp>"` alongside `OwnerId` in the same DML operation.

**Trigger side** (LeadTrigger, ContactTrigger, AccountTrigger): For UPDATE events, checks if `Routing_Action__c` changed AND starts with `"assigned"`. If the engine just stamped it, skips the record:

```apex
if (l.Routing_Action__c != old.Routing_Action__c
    && l.Routing_Action__c != null
    && l.Routing_Action__c.startsWith('assigned')) continue;
```

#### Layer 3 — Engine-Side Cooldown (`apps/engine/src/cooldown.ts`)

Before updating owner, sets Redis key `cooldown:${orgId}:${recordId}` with 30s TTL. Before processing any UPDATE event, checks the key and logs `COOLDOWN_SKIPPED` if present.

- **Critical timing**: `setCooldown()` must execute BEFORE `updateOwner()` — because `updateOwner()` triggers Salesforce's `after update` trigger which sends the UPDATE callout back to the engine immediately. If cooldown is set after, the UPDATE arrives before the Redis key exists.
- Fail-open: returns `false` if Redis is unavailable
- Defense in depth for edge cases where Apex guard might not catch it

#### Layer 4 — Observability & Proactive Alerting

- **`RoutingStatus` enum**: Added `COOLDOWN_SKIPPED` and `STAMP_SKIPPED` values
- **`GET /api/health/recursive`**: Returns counts of cooldown skips, stamp skips, and recursive bounces (records SUCCESS 2+ times within 60s) across 1h/24h/7d windows
- **`RecursiveAlertBanner`**: Persistent dashboard banner (red for breaches, amber for cooldown activity), dismissible, polls every 60s
- **Activity page**: Warning badges for `COOLDOWN_SKIPPED`/`STAMP_SKIPPED` entries; recursive bounce detection with tooltip
- **Analytics page**: "System Health" section with 3 KPI cards (Recursive Events, Cooldown Skips, Stamp Skips)
- **Trigger Health page** (`apps/web/app/(dashboard)/trigger-health/page.tsx`): Dedicated dashboard showing health status banner (green/amber/red), KPI cards, safeguard layer status, and recent events table with status badges. Auto-refreshes every 60s via TanStack Query. Accessible from sidebar under "Verify & Debug".

### 18.3 File Map

| File | Change |
|------|--------|
| `apps/web/lib/sync-routing-flags.ts` | NEW — compute and sync routing flags to Salesforce |
| `apps/web/app/api/rules/route.ts` | Call `syncRoutingFlags()` after rule create |
| `apps/web/app/api/rules/[id]/route.ts` | Call `syncRoutingFlags()` after PUT and DELETE |
| `apps/web/app/api/rules/[id]/clone/route.ts` | Call `syncRoutingFlags()` after clone |
| `apps/web/app/api/rules/[id]/status/route.ts` | Call `syncRoutingFlags()` after status toggle |
| `apps/web/app/api/integrations/salesforce/deploy/route.ts` | Replace hardcoded flags with `syncRoutingFlags()` |
| `apps/engine/src/cooldown.ts` | NEW — Redis setCooldown/isInCooldown |
| `apps/engine/src/router.ts` | Cooldown check + `setCooldown()` + `ROUTING_ACTION_FIELD` on all `updateOwner()` calls |
| `packages/sfdc/src/update-owner.ts` | Optional `routingActionField` parameter for field stamp |
| `packages/db/prisma/schema.prisma` | Added `COOLDOWN_SKIPPED`, `STAMP_SKIPPED` to `RoutingStatus` |
| `packages/db/prisma/migrations/20260312200000_add_cooldown_stamp_status/` | Enum migration |
| `apps/cli/sfdc-package/.../objects/{Lead,Contact,Account}/fields/Routing_Action__c.field-meta.xml` | NEW — custom field for stamp |
| `apps/cli/sfdc-package/.../triggers/{Lead,Contact,Account}Trigger.trigger` | Stamp guard in UPDATE loop |
| `apps/web/app/api/health/recursive/route.ts` | NEW — recursive event counts API |
| `apps/web/components/recursive-alert-banner.tsx` | NEW — dashboard warning banner |
| `apps/web/app/(dashboard)/layout.tsx` | Include `RecursiveAlertBanner` |
| `apps/web/app/(dashboard)/activity/page.tsx` | Warning badges + recursive bounce detection |
| `apps/web/app/(dashboard)/analytics/page.tsx` | System Health KPI cards |
| `apps/web/app/(dashboard)/trigger-health/page.tsx` | NEW — Trigger Health observability dashboard |
| `apps/web/components/layout/sidebar.tsx` | Added "Verify & Debug" section with Trigger Health link |
| `apps/web/proxy.ts` | Exact-match `/api/health` (prevents auth bypass on sub-routes) |

### 18.4 Verification Checklist

1. Create INSERT-only rule → verify `Lead_Update_Enabled__c = false` in Salesforce
2. Create lead → one event (INSERT only), no UPDATE bounce
3. Create UPDATE rule → verify flag flips to `true`; delete rule → flips back
4. After routing: check `lrt__Routing_Action__c = "assigned:..."` on the lead
5. Manually edit a lead's Status field → UPDATE event fires normally
6. Engine logs show `COOLDOWN_SKIPPED` for edge cases
7. Activity page shows warning badges on skip entries
8. Analytics page shows System Health KPI cards
9. Trigger Health page (`/trigger-health`) shows green banner, KPI cards, safeguard layers
10. Recursive alert banner appears when bounce threshold exceeded

---

## 19. Record Journey — Routing Audit Trail

### Purpose
Complete visibility into **why** a record was routed a certain way. Users enter a Salesforce Record ID on the Activity → Record Journey tab and see every routing decision: which rules were evaluated, which conditions matched/failed, what actual field values were compared, and how assignment was resolved.

### Data Model
Single `decisionTrace Json?` column on the existing `RoutingLog` model. The engine populates this with a structured JSON trace during routing. No separate model needed — trace data is always read alongside the log entry.

- **Migration**: `20260314000000_add_decision_trace` — adds JSONB column + composite index on `(orgId, sfdcRecordId, createdAt)`
- **Backward compatible**: Existing logs have `decisionTrace: null`. UI shows simplified view for null traces.

### DecisionTrace Schema
```
{
  version: 1,
  trigger: { event, objectType, recordId, timestampMs },
  cooldown?: { checked: true, skipped: boolean },
  rulesEvaluated: [{
    ruleId, ruleName, priority,
    outcome: "MATCHED" | "UNMATCHED" | "SKIPPED_TRIGGER_EVENT",
    matchPhase?: { config, checks[], result },
    branches?: [{ branchId, label, priority, matched, conditionGroups[] }],
    legacyConditions?: [{ groupId, groupMatched, conditions[] }],
    defaultOwner?: { evaluated, resolved }
  }],
  assignment?: { type, assigneeName, assigneeId, teamId, teamName, source, branchLabel },
  timing: { totalMs, cooldownCheckMs?, matchPhaseMs?, evaluationMs?, assignmentMs?, sfdcUpdateMs? }
}
```

### Engine Instrumentation
- `evaluateRuleDetailed()` in `evaluator.ts` — same logic as `evaluateRule()` but returns per-condition pass/fail with actual values
- `router.ts` builds a `DecisionTrace` object alongside routing execution:
  - Cooldown check → `trace.cooldown`
  - Rule filtering → `trace.rulesEvaluated` (skipped trigger events)
  - Match phase → `ruleTrace.matchPhase` (config, checks, result)
  - Branch evaluation → `ruleTrace.branches` (each with `evaluateRuleDetailed` results)
  - Default owner → `ruleTrace.defaultOwner`
  - Assignment → `trace.assignment`
- Trace is attached to the final routing log via `attachTrace()` after routing completes (single DB update, avoids modifying every log create call)

### APIs
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/routing-logs/journey/[recordId]` | GET | All routing events for one record (limit 50) |
| `/api/routing-logs/journey/batch` | POST | Batch: up to 100 record IDs, grouped response with `meta` block |

**Batch request**: `{ recordIds: string[], limit?: number, since?: string }`
**Batch response**: `{ records: { [id]: { objectType, totalEvents, entries[] } }, meta: { requestedIds, foundIds, missingIds, truncated } }`

### UI Components
| File | Purpose |
|------|---------|
| `app/(dashboard)/activity/journey/page.tsx` | Search bar + record header + results container |
| `components/record-journey/JourneyTimeline.tsx` | Vertical timeline rendering all events |
| `components/record-journey/JourneyStep.tsx` | Expandable event card with trace detail |
| `components/record-journey/ConditionTable.tsx` | Field/operator/expected/actual/result table (green/red rows) |
| `components/record-journey/AssignmentCard.tsx` | Assignment detail with team/RR info |
| `components/record-journey/TimingBreakdown.tsx` | Horizontal bar chart showing time per phase |

### Activity Side Panel
Clicking any row in the Routing History table opens a Sheet (slide-in panel) showing the full journey detail for that routing event — same `TraceDetail` / `NoTraceDetail` components used in the Record Journey tab. Implemented in `activity/page.tsx` using shadcn `Sheet` component.

### Journey Steps (per event)
1. **Trigger** — event type, object type, timestamp
2. **Cooldown Check** — pass/blocked
3. **Match / Dedup Check** — which objects searched, which fields used, result
4. **Rule Evaluation** — all rules evaluated with expandable condition tables
5. **Assignment** — type, team, round-robin position, source

### Test Coverage
| File | Tests | Coverage |
|------|-------|----------|
| `apps/engine/src/evaluator-detailed.test.ts` | 10 | `evaluateRuleDetailed()` — pass/fail detail, group logic, value capture, truncation, case normalization |
| `apps/engine/src/router.test.ts` (§ Decision Trace) | 7 | Trace attachment via `findFirst`+`update`, trigger info, UNMATCHED/SKIPPED rules, timing, branch traces, null safety |
| `apps/web/app/api/routing-logs/journey/[recordId]/route.test.ts` | 8 | Auth, ID validation, scoping, empty results, 15/18-char IDs, limit |
| `apps/web/app/api/routing-logs/journey/batch/route.test.ts` | 10 | Auth, empty/missing IDs, 100-ID limit, grouping, meta block, invalid IDs, per-record limit |

### Migration Strategy
- Existing RoutingLog entries have `decisionTrace: null`
- UI shows simplified view for null traces (using existing flat fields)
- Info banner: "Detailed routing trace is not available for events before this feature was enabled"
- No backfill needed — traces accumulate going forward

---

## 20. Scheduled Routes & Search Salesforce Trigger

### Purpose
Enables **batch/retrospective routing**: the system queries Salesforce on a schedule (or manually) for records matching user-defined criteria, then feeds them through the same routing pipeline used by real-time triggers. This is a new route type (`SCHEDULED`) that runs independently of the Apex trigger.

### Architecture Overview
```
                REAL-TIME FLOW (existing)
Salesforce Apex ──POST──▶ Engine /route ──▶ routeRecord() ──▶ SFDC Update

                SCHEDULED FLOW (new)
BullMQ Cron Job ──▶ Engine: runScheduledRoute()
                      ├── Build SOQL from searchCriteria + objectType
                      ├── Query Salesforce (batched, paginated)
                      ├── For each record: routeRecord({ eventType: "SEARCH", ruleId })
                      ├── Update rule stats (lastRunAt, totalRuns, etc.)
                      └── Log run result

Web UI "Run Now" ──POST──▶ /api/rules/[id]/run
                      ├── Build SOQL from searchCriteria (filters empty values)
                      ├── Query Salesforce REST API (comprehensive field list)
                      ├── POST /route/batch (HMAC-signed, ruleId + eventType: SEARCH)
                      ├── Engine: BullMQ worker → routeRecord({ ruleId }) per record
                      └── Only target rule evaluated (others skipped)
```
Both flows converge at `routeRecord()` — same evaluator, branches, match step, and assignment logic. The only difference is the **source of records** (Apex webhook vs SOQL query).

### Schema Changes

**New enum**: `RouteType` (`REALTIME` | `SCHEDULED`)
**Extended enum**: `TriggerEvent` — added `SEARCH` value

**New fields on `RoutingRule`**:
| Field | Type | Purpose |
|-------|------|---------|
| `routeType` | `RouteType` | Distinguishes real-time from scheduled routes (default: `REALTIME`) |
| `scheduleFrequency` | `String?` | `DAILY` / `WEEKLY` / `MONTHLY` / null (one-time) |
| `scheduleTime` | `String?` | Time of day in 24h format, e.g. `"06:00"` |
| `scheduleTimezone` | `String?` | IANA timezone, e.g. `"UTC"`, `"US/Eastern"` |
| `scheduleCron` | `String?` | Computed cron expression for BullMQ |
| `searchCriteria` | `Json?` | `ConditionGroup[]` — same shape as trigger conditions |
| `lastRunAt` | `DateTime?` | Timestamp of last scheduled execution |
| `lastRunStatus` | `String?` | `SUCCESS` / `FAILED` / `PARTIAL` |
| `lastRunRecords` | `Int?` | Records routed in last run |
| `lastRunDurationMs` | `Int?` | Duration of last run |
| `totalRuns` | `Int` | Cumulative run count |
| `totalRecordsRouted` | `Int` | Cumulative records routed across all runs |

**Migration**: `20260314000000_add_route_type`

### Engine Files

| File | Purpose |
|------|---------|
| `apps/engine/src/soql-builder.ts` | Converts `ConditionGroup[]` → SOQL queries. `buildSearchSOQL()` for data retrieval, `buildCountSOQL()` for preview counts. Includes SOQL injection prevention via `escapeSoqlField()` / `escapeSoqlValue()`. Smart quoting: numeric values and SOQL date literals (`LAST_N_DAYS:7`, `TODAY`) are unquoted. |
| `apps/engine/src/search-runner.ts` | Core execution logic: `runScheduledRoute(ruleId, orgId)` — loads rule, builds SOQL, issues COUNT query to decide execution path. **Two-tier execution**: REST path for <2K records (paginates SFDC query, routes each record via `routeRecord()`), Bulk API 2.0 path for >=2K records (delegates to `bulk-search.ts` streaming orchestrator). Updates rule stats on completion. See [§25 Bulk API 2.0](#25-bulk-api-20--search-trigger-execution) for the bulk path. |
| `apps/engine/src/scheduler.ts` | BullMQ cron job manager: `initScheduler()` creates queue + worker, `syncScheduledJobs()` upserts/removes repeatable jobs based on active scheduled rules. Called on startup and cache invalidation. |
| `apps/engine/src/routes/scheduled.ts` | Fastify plugin: `POST /run-scheduled` (manual trigger) and `POST /preview-count` (record count without routing). |

### Router Changes
- `RoutingPayload.eventType` now includes `"SEARCH"`
- `RoutingPayload.ruleId` (optional) — when set, only the specified rule is evaluated (all others are skipped with `SKIPPED_TRIGGER_EVENT` trace)
- SEARCH events bypass the `triggerEvent` filter (no INSERT/UPDATE check)
- SEARCH events only match rules with `routeType === "SCHEDULED"` (or when `targetRuleId` is set)
- The web run endpoint (`POST /api/rules/:id/run`) passes `ruleId` through to engine `/route/batch`, which threads it through BullMQ jobs to `routeRecord()` — ensuring only the target scheduled rule evaluates records, even when multiple scheduled rules exist

### Cache Changes
`CachedRule` extended with: `routeType`, `searchCriteria`, `scheduleFrequency`, `scheduleCron`

### Web API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rules` | GET | Returns `routeType`, schedule fields, run stats |
| `/api/rules` | POST | Accepts `routeType`, schedule fields, `searchCriteria` |
| `/api/rules/[id]` | PUT | Updates schedule fields |
| `/api/rules/[id]/run` | POST | Manual execution of scheduled routes (ADMIN only) |
| `/api/rules/[id]/preview` | GET | Returns count of records matching `searchCriteria` |

### Frontend Components

| File | Purpose |
|------|---------|
| `components/route-builder/types.ts` | Added `RouteType`, `ScheduleFrequency`, `SearchTriggerConfig` types. `RouteBuilderState` now includes `routeType` and `searchTrigger`. |
| `components/route-builder/config/SearchTriggerConfigSheet.tsx` | Config panel for search trigger: name, object type, search criteria (reuses `ConditionBuilder`), frequency (Schedule vs One-time with amber disclaimer), advanced section (batch size, skip recently routed, dry run). |
| `components/route-builder/StepRegistry.tsx` | Added `searchTrigger` node type. Registry now has 3 sections: Triggers, Actions, (implicit Notifications placeholder). |
| `components/route-builder/RouteBuilder.tsx` | Canvas supports dual trigger nodes (real-time violet + search teal), both fan-out to match. Drop handler creates searchTrigger node beside trigger. Delete handler re-centers trigger. |
| `lib/builder-to-rule.ts` | Converts `searchTrigger` config → API body with `routeType: "SCHEDULED"`, `triggerEvent: "SEARCH"`, schedule fields, and `searchCriteria`. Reverse conversion (`apiRuleToBuilderState`) reconstructs `searchTrigger` from rule data. |

### BullMQ Scheduler
- Queue name: `route-scheduler`
- Worker concurrency: 3
- Job key format: `route-{ruleId}`
- `syncScheduledJobs()` called on engine startup + cache invalidation
- Stale jobs (inactive/deleted rules) automatically cleaned up
- Repeatable jobs use `upsertJobScheduler()` with cron pattern from `scheduleCron`

### Test Coverage
| File | Tests |
|------|-------|
| `apps/engine/src/soql-builder.test.ts` | 22 — all operators, date literals, numeric values, injection escaping, COUNT queries |
| `apps/web/lib/builder-to-rule.test.ts` | 13 — includes searchTrigger → API body conversion |
| `apps/engine/src/router.test.ts` | ruleId targeting — skips non-target rules, routes only target rule, unmatched when conditions fail |
| `apps/web/lib/route-to-english.test.ts` | Search trigger section — daily/one-time schedules, criteria, dry run, batch size, coexistence with real-time trigger, warnings |
| `apps/web/lib/build-soql.test.ts` | Empty-value filtering — skips empty values for value-requiring operators, keeps no-value operators (is_blank, is_true) |

---

## 21. Weighted Round Robin Distribution

### 21.1 Overview

Teams now support two distribution modes controlled by the `distributionType` column on `RoundRobinTeam`:

| Mode | Value | Behavior |
|------|-------|----------|
| **Equal Round Robin** | `"round-robin"` (default) | Members receive leads in strict sequential order, one each in turn |
| **Weighted Round Robin** | `"weighted"` | Members receive leads proportional to their `weight` values |

Switching distribution type is non-destructive — each mode uses a separate Redis pointer key (`rr:` vs `wrr:`), so reverting preserves the other mode's position.

### 21.2 Schema

**`RoundRobinTeam.distributionType`** — `String @default("round-robin")`, values: `"round-robin"` | `"weighted"`

**`TeamMember.weight`** — `Int @default(1)` (pre-existing column, now actively used in weighted mode)

### 21.3 Engine Algorithm (`round-robin.ts`)

**`getNextWeightedMember(orgId, teamId, activeMembers)`:**

1. **GCD normalization** — Divide all weights by their GCD to minimize the virtual slot array size. Example: weights [40, 40, 20] → GCD 20 → normalized [2, 2, 1] → 5 total slots
2. **Deficit-based interleaving** — Build a slot array where members are spread evenly rather than clustered:
   - For each slot position, pick the member with the highest "deficit" score
   - Deficit = `(idealFraction * (position + 1)) - filledSoFar`
   - Produces `[A, B, A, B, C]` instead of `[A, A, B, B, C]`
3. **Atomic Redis pointer** — Same Lua script as equal RR (`INCR + modulo`), but modulo is over total virtual slots, and the result maps back to a member via the slot array
4. **Separate Redis key** — `wrr:{orgId}:{teamId}:pointer` (not `rr:`)

**`resetWeightedPointer(orgId, teamId)`** — Resets the weighted pointer to 0.

### 21.4 Router Integration (`router.ts`)

In `resolveAssigneeFromFields()`, the ROUND_ROBIN branch:
1. Fetches `team.distributionType` alongside the team data
2. If `"weighted"` → calls `getNextWeightedMember()` with members including their `weight` field
3. If `"round-robin"` → calls existing `getNextMember()` (unchanged)

### 21.5 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `PUT /api/teams/:id/weights` | PUT | Bulk update member weights. Body: `{ mode: "percentage" \| "points", weights: { [userId]: number } }`. Percentage mode: values must sum to 100. Points mode: values must sum to 10. All values must be non-negative integers. All userIds must be existing team members. |
| `PATCH /api/teams/:id/members/:userId` | PATCH | Update individual member status + optional `weight` field |
| `GET /api/teams/:id` | GET | Returns `distributionType` on team + `weight` per member |
| `POST /api/teams` | POST | Accepts optional `distributionType` (validated: must be `"round-robin"` or `"weighted"`) |
| `PUT /api/teams/:id` | PUT | Accepts `distributionType` changes |

### 21.6 UI

**Team Detail Page** — Distribution type picker (two cards: Equal Round Robin / Weighted), appears below the team header. Selecting "Weighted" reveals:
- Per-member weight sliders with numeric input
- Percentage / Points mode toggle
- Distribution preview bar showing proportional allocation
- Auto-redistributing sliders (adjusting one member rebalances others)
- Equalize button to reset all weights to equal

**Team List Page** — Distribution type badge on each team card (`Round Robin` or `Weighted`).

### 21.7 Key Files

| File | Purpose |
|------|--------|
| `apps/engine/src/round-robin.ts` | `getNextWeightedMember()`, `resetWeightedPointer()`, `buildInterleavedSlots()`, `gcd()`, `gcdArray()` |
| `apps/engine/src/router.ts` | Branches on `distributionType` in ROUND_ROBIN assignment resolution |
| `apps/web/app/api/teams/[id]/weights/route.ts` | Bulk weight update endpoint with mode-based validation |
| `apps/web/app/api/teams/route.ts` | Create team with `distributionType` |
| `apps/web/app/api/teams/[id]/route.ts` | Team detail includes `distributionType` + member `weight`; PUT accepts `distributionType` |
| `apps/web/app/api/teams/[id]/members/[userId]/route.ts` | PATCH accepts optional `weight` |
| `packages/db/prisma/schema.prisma` | `distributionType` on `RoundRobinTeam`, `weight` on `TeamMember` |

### 21.8 Test Coverage

| File | Tests |
|------|-------|
| `apps/engine/src/round-robin.test.ts` | Weighted RR: empty members, single member, `wrr:` key prefix, GCD normalization (40/40/20 → 5 slots), distribution proportionality over 100 iterations, equal weights produce equal distribution, interleaving order |

---

## 22. Run Route Experience

### Purpose
Provides a full manual execution workflow for scheduled routes — from the route list (quick inline run) and from the route detail page (detailed phased execution with real-time progress tracking).

### Run Route API

**`POST /api/rules/:id/run`** — Executes a scheduled route manually. Full pipeline:
1. Loads rule's `searchCriteria` and `objectType` from database
2. Loads org's `sfdcOrgId`, `oauthAccessToken`, and `webhookSecret`
3. Builds SOQL with comprehensive field list per object type (Lead: 20+ fields, Contact: 16, Account: 14) so the engine can evaluate rule conditions
4. Filters out criteria with empty values (prevents invalid SOQL like `AnnualRevenue > ''`)
5. Queries Salesforce via REST API (`/services/data/v59.0/query`)
6. Sends records to engine via `POST /route/batch` in batches of 200, signed with HMAC-SHA256 (`X-Signature-256: sha256=<hex>`)
7. Payload includes `eventType: "SEARCH"` and `ruleId: rule.id` — ensures only the target rule evaluates records
8. Updates run stats on RoutingRule and creates audit log entry
9. Returns `{ success, recordsFound, recordsRouted, recordsDuplicate, durationMs }`

### SOQL Builder (`apps/web/lib/build-soql.ts`)

Converts `searchCriteria` JSON (same `ConditionGroup[]` shape used by trigger conditions) into a SOQL `WHERE` clause. Supported operators:

| Operator | SOQL Output |
|----------|-------------|
| `equals` | `Field = 'value'` |
| `not_equals` | `Field != 'value'` |
| `contains` | `Field LIKE '%value%'` |
| `starts_with` | `Field LIKE 'value%'` |
| `greater_than` | `Field > 'value'` |
| `less_than` | `Field < 'value'` |
| `in` | `Field IN ('a','b','c')` |
| `not_in` | `Field NOT IN ('a','b','c')` |
| `is_blank` | `Field = null` |
| `is_not_blank` | `Field != null` |

Single quotes in values are escaped (`'` → `\'`) to prevent SOQL injection.

### Route List Run UX

Clicking the **Play** button on a scheduled route card triggers inline execution:
- Progress bar appears directly on the card with phase labels and percentage
- Completion triggers a toast notification and automatic stat refresh
- No page navigation required — the user stays on the route list

### Route Detail Run UX

**"Run Route" button** in the top bar (visible only for `SCHEDULED` routes) opens the slide-out `RunPanel`:
- **Dynamic workflow phases** based on route configuration (via `RouteStepsConfig`): always includes Query SF + Assign; conditionally adds Match and Filter/Route steps based on `hasMatch`, `hasPaths`, `hasDefaultOwner`
- **Real API data** — calls `/api/rules/:id/run`, displays actual `recordsFound`, `recordsRouted`, `durationMs`
- **Elapsed timer** showing real-time duration
- **Completion summary** with record counts, green/red status
- **Error handling** with red state display on failure

### RunPanel Component (`apps/web/components/route-builder/RunPanel.tsx`)

Slide-out panel that visualizes the route execution workflow:
- `RouteStepsConfig` interface: `{ hasMatch, hasPaths, hasDefaultOwner }` — passed from `RouteBuilder`
- `buildSteps(config)` dynamically creates workflow steps based on route config
- Each phase maps to a canvas node type (trigger → match → filter → assign)
- Canvas nodes **glow teal** during their active phase and **green** when completed
- Panel slides in from the right side of the route builder canvas

### English View — Search Trigger

The English/natural language view (`route-to-english.ts`) now renders search triggers:
- Section id: `"search-trigger"`, type: `"trigger"`, title: `"SEARCH TRIGGER"`
- Renders schedule description (daily/weekly/monthly at time+timezone, or one-time/manual)
- Renders search criteria as human-readable conditions
- Shows options: skip recently routed, dry run, non-default batch size
- Validation warnings: missing search criteria (warning), active dry run (info)
- `EnglishSectionCard` renders with teal color + Search icon (distinct from violet real-time trigger)
- `PathDetailPanel` shows full config detail (object, schedule, batch size, criteria tokens)

### Key Files

| File | Purpose |
|------|---------|
| `apps/web/app/api/rules/[id]/run/route.ts` | Run Route API — SOQL build, SF query, engine `/route/batch` integration with HMAC signing + ruleId targeting |
| `apps/web/lib/build-soql.ts` | SOQL builder — `searchCriteria` → WHERE clause conversion with empty-value filtering |
| `apps/web/lib/build-soql.test.ts` | Tests for SOQL builder — operator coverage, escaping, empty values, edge cases |
| `apps/web/lib/route-to-english.ts` | English view — `buildSearchTriggerSection()` + search trigger warnings |
| `apps/web/components/route-builder/RunPanel.tsx` | Slide-out execution panel with dynamic steps, real API data, and run history |
| `apps/web/components/route-builder/EnglishView.tsx` | English view layout — renders search trigger card with teal styling |
| `apps/web/components/route-builder/PathDetailPanel.tsx` | Detail panel — search trigger config + criteria token rendering |
| `apps/web/components/route-builder/EnglishSectionCard.tsx` | Section card — teal override for search-trigger id |
| `apps/engine/src/router.ts` | `RoutingPayload.ruleId` + `targetRuleId` filtering in `routeRecord()` |
| `apps/engine/src/routes/route.ts` | Batch endpoint — extracts `ruleId` from payload, threads to BullMQ jobs |
| `apps/engine/src/batch-queue.ts` | `BatchJobData.ruleId` — worker passes to `routeRecord()` |
| `apps/engine/src/lib/schemas.ts` | Zod schemas — `SEARCH` eventType + optional `ruleId` |

---

## 23. Theme & Design System

### Color System
The app uses CSS custom properties defined in `apps/web/app/globals.css` with full light and dark mode support.

- **Light mode** (`:root`): Warm off-white palette with `#f8f7f4` background, `#6d5acd` violet primary
- **Dark mode** (`.dark`): Deep space aesthetic with `#050508` background, `#7c6aff` violet primary, glass morphism effects
- **Sidebar**: Always dark in both themes (dark nav anchor pattern, like Linear/Notion)
- **Semantic tokens**: `--success`, `--warning`, `--info` with surface variants for status colors

### Theme Toggle
- Component: `apps/web/components/theme-toggle.tsx`
- Three-state cycle: Light → Dark → System
- Uses `next-themes` (already configured in `providers.tsx` with `attribute="class"`)
- Located in sidebar footer

### Typography
- **Display font**: Clash Display (via Fontshare CDN) — used for page titles, stat numbers, headings
- **Body font**: Cabinet Grotesk (via Fontshare CDN) — default `font-sans`
- Tailwind utility: `font-display` maps to Clash Display

### Visual Effects
- **Aurora background**: Animated gradient orbs behind dashboard content (`.aurora-bg` class in dashboard layout)
- **Noise grain**: SVG feTurbulence overlay on body (1.8% light / 3% dark opacity)
- **Glass morphism**: `backdrop-filter: blur(16px)` on cards in dark mode (`.glass-card` class)
- **Animations**: `cardSlide` (staggered entrance), `shimmer` (button gradient), `pip-pulse` (status dot)
- **Reduced motion**: All animations disabled via `prefers-reduced-motion: reduce`

### Dark Mode Color Convention
All hard-coded Tailwind color classes have `dark:` counterparts:
```
bg-violet-50 dark:bg-violet-950
text-violet-600 dark:text-violet-400
border-violet-200 dark:border-violet-800
```
When adding new colored UI, always include both light and dark variants.

---

## 24. Licensing & Monetization System

### 24.1 Overview

Two-tier monetization model enforced across CLI, web app, and engine:

| Tier | Price | Rules | Orgs | Seats | Trigger Types | Advanced Features |
|------|-------|-------|------|-------|---------------|-------------------|
| **Free** | $0 | 2 | 1 | 3 | Lead only | None |
| **Pro** | $999/year ($500 renewal) | Unlimited | Unlimited | Unlimited | Lead, Contact, Account | Weighted distribution, analytics, audit logs |

Enforcement points: CLI init gate, container startup phone-home, weekly heartbeat from engine.

License server: Cloudflare Worker + D1 at `lead-routing-license.artyagi2011.workers.dev`.
Payment: Stripe subscriptions (checkout + webhooks).

### 24.2 License Server (`license-server/`)

Cloudflare Worker running a Hono router with D1 (SQLite) for license persistence. Signs offline-verifiable JWTs using Ed25519.

**Key format:** `LR-XXXX-XXXX-XXXX-XXXX`

**Endpoints:**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/licenses/validate` | Validate key, return tier + JWT token |
| `POST` | `/v1/licenses/heartbeat` | Weekly check-in from engine, extends grace window |
| `POST` | `/v1/checkout/create` | Create Stripe Checkout session for Pro upgrade |
| `POST` | `/v1/stripe/webhook` | Handle Stripe events (checkout.completed, invoice.paid, subscription.deleted) |

**Server fingerprint binding:** Licenses are bound to a hostname-based fingerprint generated during first validation. Prevents key sharing across deployments.

### 24.3 CLI License Step

Step 1 of 9 in the `init` wizard (`apps/cli/src/steps/validate-license.ts`).

1. Prompt for license key (press Enter to skip → free tier)
2. `POST /v1/licenses/validate` against the license API
3. Store `LICENSE_KEY` and `LICENSE_TIER` in `.env.web`, `.env.engine`, and `lead-routing.json`

Free-tier users skip this step entirely — containers default to free tier when no key is present.

### 24.4 Container Enforcement

**Web (`docker-entrypoint.sh`):**
- Phones home to license server before starting Next.js
- On network failure: falls back to offline JWT verification via `verify-license.js` (Ed25519 signature check)
- Defaults to free tier if no key or if server is unreachable

**Engine (`server.ts` → `start()`):**
- License check runs during engine startup
- Same fallback logic: offline JWT → free tier default

### 24.5 Feature Gating (`apps/web/lib/license.ts`)

Central gating module with three exports:

| Function | Purpose |
|----------|---------|
| `getLicenseTier()` | Reads `LICENSE_TIER` env var, returns `"free"` or `"pro"` |
| `getTierLimits()` | Returns tier-specific limits (rules, orgs, seats, trigger types) |
| `upgradeRequiredResponse()` | Returns a `402` JSON response with upgrade messaging |

**Free Tier Limits (`FREE_LIMITS`):**

| Feature | Limit |
|---------|-------|
| Seats (licensed users) | 3 |
| Routing rules | 2 |
| Object types | Lead only (Contact/Account locked) |
| Distribution | Round-robin only (no weighted) |
| Analytics | Not available |
| Audit logs | Not available |
| AI assistant | Not available |

**Pro Tier Limits (`PRO_LIMITS`):**

| Feature | Limit |
|---------|-------|
| Seats (licensed users) | Unlimited |
| Routing rules | Unlimited |
| Object types | Lead, Contact, Account |
| Distribution | Round-robin + weighted |
| Analytics & conversions | Full access |
| Audit logs | Full access |
| AI assistant | Full access |

**Enforcement Points:**

| Layer | Location | Behavior |
|-------|----------|----------|
| **UI** | `TriggerConfigSheet`, `SearchTriggerConfigSheet`, integrations/salesforce page | Contact/Account `SelectItem`s disabled with PRO badge overlay |
| **API** | `POST /api/rules`, `POST /api/rules/[id]/clone`, `POST /api/fields/sync`, `GET /api/integrations/salesforce/objects` | Return `402 upgrade_required` when free-tier limits exceeded |
| **API** | `POST /api/users/:id/license`, `POST /api/users/bulk-license` | Seat count limit enforcement |
| **API** | `PUT /api/teams/:id/weights` | Pro only (weighted distribution) |
| **API** | `GET /api/analytics/*` | Pro only |
| **API** | `GET /api/audit-logs` | Pro only |
| **Seed** | `seed.js` | Reads `LICENSE_TIER` env var → sets `seatsPurchased` (3 for free, 9999 for pro) |
| **Config** | `apps/web/lib/license.ts` | `FREE_LIMITS` and `PRO_LIMITS` objects, `getLicenseTier()` reads `process.env.LICENSE_TIER` |

### 24.6 UI Paywalls & Upgrade Prompts

Free-tier users see paywalled previews across the dashboard to entice upgrades. Each paywall shows real-looking dummy data behind a frosted overlay with an "Upgrade to Pro" CTA linking to `https://openedgeai.tech/pricing`.

| Page | Component/File | Behavior |
|------|---------------|----------|
| **Routing Rules** | `apps/web/app/(dashboard)/routing-rules/page.tsx` | Violet banner at top when rule limit reached. "New Route" button disabled with Pro badge. Clone button disabled with tooltip. Fetches `/api/license` to check limits. |
| **Analytics** | `apps/web/app/(dashboard)/analytics/page.tsx` | Dummy KPI cards (2,847 routed, 94.2% success, 4.8s speed), volume chart, and top-rules table rendered behind `blur-[3px] opacity-40` overlay. `AnalyticsPaywall` component overlays with lock icon. Real API queries disabled (`enabled: !isFree`). |
| **AI Assistant** | `apps/web/components/ai-chat/ChatWindow.tsx` + `PaywallOverlay.tsx` | Dummy chat conversation with inline KPI cards, bar charts, and team comparison table behind `blur-[3px] opacity-40`. `PaywallOverlay` renders as a solid card (`bg-white dark:bg-gray-900 shadow-2xl`) centered over the blurred content. Feature checklist included. |
| **Settings > AI Assistant** | `apps/web/app/(dashboard)/settings/ai/page.tsx` | License check via `/api/license`. Free tier shows paywall card (`fixed` centered on viewport) over blurred provider cards and usage stats (`blur-[3px] opacity-40`). |

**Sidebar badges:** Analytics and AI Assistant show gradient "Pro" badges. Activity does not have a Pro badge (it is available on all tiers).

**Design pattern:** All paywalls use consistent styling — violet gradient CTA button, `shadow-2xl shadow-violet-500/10` on the overlay card, and `blur-[3px] opacity-40` on background content to keep it visible but clearly inaccessible.

### 24.7 Heartbeat System (`apps/engine/src/license-heartbeat.ts`)

BullMQ repeatable job scheduled for Sundays at 00:00 UTC. Also fires on engine startup.

- `POST /v1/licenses/heartbeat` with license key + server fingerprint
- Result cached in Redis key `license:heartbeat:latest`
- Web dashboard reads heartbeat status via `GET /api/license/status`

### 24.8 Grace Period

After a Stripe subscription lapses (non-renewal or cancellation):

1. **30-day grace period** — Pro features continue working
2. **After grace** — automatic downgrade to free tier
3. **Data preservation** — no data is deleted; existing rules/users beyond free-tier limits become read-only

### 24.9 Marketing Site Architecture

Static HTML site served by Caddy at `openedgeai.tech`. Deployed independently from the lead-routing application stack.

**Deployment:**
- Served from `/root/marketing-site/` on the VPS via a standalone `marketing-caddy` container
- Has its own `docker-compose.yml` and `Caddyfile` at `/root/marketing-site/`
- Uses `restart: unless-stopped` — survives VPS reboots without manual intervention
- Completely independent from the lead-routing stack at `/root/lead-routing/`
- When testing `lead-routing init` on the same VPS, must stop `marketing-caddy` first to free ports 80/443

**Files:**

| File | Purpose |
|------|---------|
| `index.html` | Landing page with pricing, features, hero section |
| `dashboard.html` | Product screenshots / demo page |
| `docs.html` | Full documentation page (see 24.9.1 below) |
| `login.html` | Marketing login page |
| `signup.html` | Marketing signup page |
| `verify-email.html` | Email verification page |
| `shared.css` | Shared styles across all marketing pages |

- Stripe Checkout integration for Pro purchases (links to `POST /v1/checkout/create`)
- Test mode: card `4242 4242 4242 4242`

#### 24.9.1 Documentation Page (`site/docs.html`)

Full documentation page with dark theme, providing setup guides, how-to videos, FAQ, and troubleshooting.

**Layout:** Three-part responsive layout:
- Left sidebar (260px fixed) — section navigation with nested links
- Scrollable main content area — all documentation sections
- Sticky right TOC — table of contents tracking current scroll position

**Sections:**
1. **Setup Guide** — All 15 setup steps migrated from `docs/setup-guide.html`
2. **How To Videos** — Video embeds for common workflows
3. **FAQ** — Accordion-style frequently asked questions
4. **Troubleshooting** — Common issues and fixes
5. **Changelog** — Version history and release notes

**JavaScript Features:**
- `IntersectionObserver` for active navigation highlighting as user scrolls
- Search filter to find documentation sections by keyword
- Copy-to-clipboard on code blocks
- Video embed support
- FAQ accordion (expand/collapse)

**Styling:** CSS lives in `site/shared.css` under the `/* -- Docs -- */` section.

**Mobile:** Responsive design with hamburger menu toggling the left sidebar on smaller viewports.

### 24.10 Stripe Integration

**Webhook events handled:**

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Activate Pro license, bind to server fingerprint |
| `invoice.paid` | Extend license expiry |
| `customer.subscription.deleted` | Start 30-day grace countdown |

Test mode card: `4242 4242 4242 4242`, any future expiry, any CVC.

---

## 25. Bulk API 2.0 System — Scheduled Search at Scale

### Overview

The Bulk API 2.0 system enables "Search Salesforce" trigger rules to process millions of records efficiently. Rather than using the REST API for all queries (which hits Salesforce governor limits at scale), the engine automatically selects the optimal execution path based on record count, streams results without loading them all into memory, and writes owner updates back to Salesforce using Bulk API 2.0 ingest jobs.

### Architecture — Two-Tier Execution

The system uses a COUNT query to decide the execution path:

```
Scheduler cron fires (or manual "Run Route")
  → search-runner.ts: COUNT query against Salesforce
  → Decision:
      < 2,000 records → REST path (existing paginated query + per-record routing)
      ≥ 2,000 records → Bulk API 2.0 path (streaming + batch routing + bulk writes)
```

**REST path** (<2K records): Uses `conn.query()` with pagination, routes each record individually via `routeRecord()`, updates owners one at a time. Simple, fast for small datasets.

**Bulk API path** (>=2K records): Full streaming pipeline described below.

### Bulk API Data Flow

```
search-runner.ts decides Bulk path
  → Creates BulkSearchRun DB row (status: RUNNING)
  → bulk-search.ts: conn.bulk2.query(soql) → streaming CSV records
  → Auto-scaling batch size: 500 for small queries, 10K for ≥10K records
  → Buffer into micro-batches
  → Per batch: batchMatchRecords() → IN-clause matching (500x fewer API calls)
  → Enqueue matched records to bulk-search-queue (BullMQ)
  → Worker Phase A: routeRecord(skipSfdcWrite=true) → collect (recordId, ownerId, logId) tuples
  → Worker Phase B: bulkUpdateOwners() → single Bulk API 2.0 ingest job per batch
  → Reconcile: update routing logs SUCCESS/FAILED based on write results
  → Redis progress tracking (phase: routing → writing → complete)
```

Both paths converge at `routeRecord()` — same evaluator, branches, match step, and assignment logic. The key difference: the Bulk path uses `skipSfdcWrite=true` to separate the routing decision from the SFDC write, collecting assignments into a mutable `_assignments` array, then submitting them as a single Bulk API 2.0 update job.

### Key Files

| File | Purpose |
|------|---------|
| `apps/engine/src/bulk-search.ts` | Bulk API 2.0 streaming orchestrator — streams records from `conn.bulk2.query()`, buffers into micro-batches, runs batch matcher, enqueues to BullMQ. Implements back-pressure (pauses stream when queue depth > 10K pending jobs), stale run detection (skips if existing RUNNING bulk run started within 6 hours), and cancel support (Redis flag checked between micro-batches). |
| `apps/engine/src/bulk-search-queue.ts` | BullMQ queue + two-phase worker: Phase A collects routing decisions (`skipSfdcWrite`), Phase B submits single Bulk API 2.0 update job per batch. Reconciles routing log statuses (RETRY → SUCCESS/FAILED) based on write results. |
| `apps/engine/src/batch-matcher.ts` | Batched match queries using IN clauses — 500x reduction in API calls vs per-record matching. Evaluates rule filter criteria against bulk records to determine which records to route. |
| `apps/engine/src/search-runner.ts` | Entry point: COUNT query → decides REST or Bulk path. REST path handles <2K records inline. Bulk path delegates to `bulk-search.ts`. |
| `packages/sfdc/src/update-owner.ts` | Added `bulkUpdateOwners()` — Bulk API 2.0 ingest for owner updates. Creates an ingest job, uploads CSV of `(Id, OwnerId)` pairs, closes and polls for completion. Includes `INVALID_FIELD` fallback for orgs with restricted field-level security. |
| `apps/engine/src/server.ts` | Engine endpoints: `GET /bulk-run/:runId/status`, `POST /bulk-run/:runId/cancel` |
| `apps/web/app/api/bulk-run/[runId]/status/route.ts` | Proxies to engine for live progress, falls back to DB for completed runs |
| `apps/web/app/api/bulk-run/[runId]/cancel/route.ts` | Forwards cancel request to engine (sets Redis cancellation flag) |
| `apps/web/components/route-builder/config/SearchTriggerConfigSheet.tsx` | UI for configuring `searchMaxRecords`/`searchBatchSize` + run progress bar |

### Key Design Decisions

- **`skipSfdcWrite` flag on RoutingPayload** — Separates the routing decision from the SFDC write. In the Bulk path, `routeRecord()` evaluates conditions and determines the assignee but does NOT call the single-record SFDC update API. Instead, assignments are collected for batch submission.
- **`_assignments` mutable array** — Side-channel for collecting `(recordId, ownerId, logId)` tuples during Phase A. After all records in a batch are routed, Phase B reads this array and submits a single Bulk API 2.0 ingest job.
- **Routing logs created with RETRY status** — During Phase A (decision phase), routing logs are written with status `RETRY`. After Phase B (bulk write), logs are updated to `SUCCESS` or `FAILED` based on the Bulk API job results. This ensures logs reflect the actual write outcome, not just the routing decision.
- **Back-pressure** — The streaming orchestrator pauses the `bulk2.query()` stream when the BullMQ queue depth exceeds 10K pending jobs, preventing memory exhaustion on very large datasets.
- **Stale run detection** — Before starting a new bulk run, the system checks for any existing `RUNNING` bulk run for the same rule that started within the last 6 hours. If found, the new run is skipped to prevent duplicate processing.
- **Cancel support** — A Redis key `bulk-cancel:{runId}` is checked between micro-batches. When set, the orchestrator stops streaming, drains in-flight batches, and marks the run as `CANCELLED`.
- **Auto-scaling batch size** — 500 records per micro-batch for queries returning <10K records, 10K per micro-batch for larger queries. Configurable per rule via `searchBatchSize`.

### DB Model: BulkSearchRun

Tracks each bulk search execution with status, record counts, timing, and error details.

```prisma
model BulkSearchRun {
  id                String    @id @default(cuid())
  orgId             String
  ruleId            String
  status            String    @default("RUNNING")  // RUNNING | COMPLETED | FAILED | CANCELLED
  recordsFound      Int       @default(0)
  recordsProcessed  Int       @default(0)
  recordsRouted     Int       @default(0)
  recordsFailed     Int       @default(0)
  recordsSkipped    Int       @default(0)
  error             String?
  startedAt         DateTime  @default(now())
  completedAt       DateTime?
  durationMs        Int?
  maxRecords        Int?
  batchSize         Int?
  org               Organization @relation(...)
  rule              RoutingRule  @relation(...)
  @@map("bulk_search_runs")
}
```

**New fields on `RoutingRule`**:
| Field | Type | Purpose |
|-------|------|---------|
| `searchMaxRecords` | `Int?` | Cap records per run (default: 10,000) |
| `searchBatchSize` | `Int?` | Micro-batch size — 200/500/1K/5K/10K (default: 200) |

**Migration**: `20260316100000_add_bulk_search_runs`

### Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /bulk-run/:runId/status` | GET | Live progress: phase, processed, routed, failed, writePending. Engine reads from Redis for in-progress runs. |
| `POST /bulk-run/:runId/cancel` | POST | Cancel in-progress run. Sets Redis flag, orchestrator checks between micro-batches. |
| `GET /api/bulk-run/:runId/status` | GET | Web proxy — forwards to engine for live runs, falls back to DB `BulkSearchRun` row for completed runs. |
| `POST /api/bulk-run/:runId/cancel` | POST | Web proxy — forwards cancel to engine. |

### Cancellation Flow

1. User clicks Cancel in the progress UI
2. Web API forwards `POST /bulk-run/:runId/cancel` to engine
3. Engine sets `bulk-cancel:{runId}` key in Redis
4. Orchestrator checks this flag between micro-batches and stops streaming
5. In-flight batches are drained (already-enqueued jobs complete)
6. Run status updated to `CANCELLED` in DB with final counts

### Scale Numbers (from load testing)

| Records | Engine Processing | Memory | SFDC API Calls (no match) | Estimated E2E |
|---------|-------------------|--------|---------------------------|---------------|
| 1M | 3.8s | 136 MB | ~100 bulk jobs | ~5-10 min |
| 10M | 36s | 190 MB | ~1,000 bulk jobs | ~20-30 min |
| 15M | 35s | 174 MB | ~1,500 bulk jobs | ~20-45 min |

Engine processing time covers streaming + matching + enqueuing. Estimated E2E includes Salesforce Bulk API 2.0 job processing time (SFDC processes bulk jobs asynchronously, typically 1-5 min per job depending on org load).

### Configuration (via UI)

Both settings are configurable per rule in the SearchTriggerConfigSheet advanced section:

- **`searchMaxRecords`** — Maximum records to process in a single run. Options: 1K / 5K / 10K / 50K / 100K / 500K / 1M / Unlimited. Default: 10,000.
- **`searchBatchSize`** — Micro-batch size for streaming processing. Options: 200 / 500 / 1K / 5K / 10K. Default: 200. Larger batches reduce overhead but increase memory per batch.

---

## 26. MCP Server (Claude Code Integration)

**Package:** `apps/mcp` → `@lead-routing/mcp` (npm)
**Stack:** `@modelcontextprotocol/sdk`, tsup ESM, Node 20+

### 26.1 Overview

stdio-based MCP server that gives Claude Code full access to the Lead Routing system. Pure HTTP client — no Prisma, no direct DB access. All operations go through the engine and web app APIs.

- **19 tools:** routing (2), rules CRUD (5), teams CRUD (6), users (2), monitoring (3), sync (1)
- **2 resources:** `lead-routing://rules`, `lead-routing://teams`

### 26.2 Architecture

```
Claude Code → stdio → MCP Server (local) → HTTP → Engine (/route, /route/batch)
                                          → HTTP → Web App (/api/rules, /api/teams, etc.)
```

| Client | Target | Auth Mechanism |
|--------|--------|----------------|
| `engine-client.ts` | Engine | HMAC-SHA256 signature (`X-Signature-256` header) |
| `web-client.ts` | Web App | Bearer token (`Authorization: Bearer lr_...`) |

### 26.3 API Token System

Tokens authenticate MCP server requests to the web app, bypassing iron-session.

| Aspect | Detail |
|--------|--------|
| Model | `ApiToken` in Prisma (`tokenHash`, `prefix`, `scopes`, `expiresAt`, `revokedAt`) |
| Format | `lr_` + 40 hex chars; SHA-256 hash stored in DB |
| Auth flow | `proxy.ts` checks `Authorization: Bearer` header BEFORE session check — falls through to session if no Bearer present |
| Session fallback | `requireSession()` falls back to header-based auth for Bearer tokens |
| Endpoints | `POST/GET/DELETE /api/tokens` + settings UI page |

### 26.4 Preview/Confirm Pattern

All write tools default to `confirm: false`. The first call returns a preview of what would happen; a second call with `confirm: true` executes the operation. Routing tools default to dry-run mode.

### 26.5 Local Audit Logging

- JSON lines at `~/.lead-routing/mcp.log`
- Logs every tool call: timestamp, tool name, action, input, result, duration
- 10 MB rotation, 3 files kept

### 26.6 Setup

```bash
claude mcp add --scope user --transport stdio lead-routing \
  --env ENGINE_URL=https://engine.example.com \
  --env APP_URL=https://app.example.com \
  --env API_TOKEN=lr_... \
  --env WEBHOOK_SECRET=... \
  --env SFDC_ORG_ID=00D... \
  -- npx -y @lead-routing/mcp
```

### 26.7 Key Files

| File | Purpose |
|------|---------|
| `apps/mcp/src/index.ts` | MCP server entry point, tool registration |
| `apps/mcp/src/clients/engine-client.ts` | HMAC-signed HTTP client for engine |
| `apps/mcp/src/clients/web-client.ts` | Bearer-authenticated HTTP client for web app |
| `apps/mcp/src/tools/` | 19 tool handlers |
| `apps/web/proxy.ts` | Bearer token auth (lines 48-78) |
| `apps/web/lib/session.ts` | `requireSession()` with Bearer fallback |
| `apps/web/app/api/tokens/` | Token CRUD endpoints |
