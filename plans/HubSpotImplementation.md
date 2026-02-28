# HubSpot Routing Engine Integration Plan

## Context

The current routing engine is fully operational for Salesforce. The core assignment logic (rule evaluation, round-robin, idempotency, retry queue, notifications) is CRM-agnostic. The goal is to add first-class HubSpot support so that customers using HubSpot CRM can use the same routing product — selecting HubSpot as their CRM during onboarding, having HubSpot contacts/deals/companies routed automatically, and having the owner field updated back in HubSpot.

---

## What's Already CRM-Agnostic (Reuse As-Is)

| Component | File | Why It's Generic |
|-----------|------|-----------------|
| Evaluator | `apps/engine/src/evaluator.ts` | Operators work on any field map |
| Round-Robin | `apps/engine/src/round-robin.ts` | Pure Lua/Redis assignment logic |
| Rule Cache | `apps/engine/src/cache.ts` | Key is `orgId:objectType`, not CRM |
| Idempotency | `apps/engine/src/idempotency.ts` | Timestamp-keyed Redis NX check |
| Retry Queue | `apps/engine/src/queue.ts` | BullMQ job, just needs a write-back fn |
| Audit Logs | `apps/web/app/api/audit-logs/` | Fully generic |
| Routing Logs | `apps/web/app/api/routing-logs/` | References `objectType`, not CRM |
| Teams/Round-Robins | `apps/web/app/api/teams/` | Pure assignment management |

---

## What Needs to Change

### 1. Database Schema (`packages/db/prisma/schema.prisma`)

**New enum + fields:**
```prisma
enum CrmType { SALESFORCE HUBSPOT }

model Organization {
  // existing fields ...
  crmType              CrmType   @default(SALESFORCE)
  // HubSpot-specific (nullable — only for HUBSPOT orgs):
  hubspotPortalId      String?   @unique
  hubspotAccessToken   String?
  hubspotRefreshToken  String?
  hubspotTokenExpiry   DateTime?
}
```

**Generalise object type enum:**
```prisma
enum ObjectType {
  // Salesforce
  LEAD CONTACT ACCOUNT
  // HubSpot
  HS_CONTACT HS_DEAL HS_COMPANY
}
```
Rename `SfdcObjectType` → `ObjectType` across all models (`RoutingRule`, `RoutingLog`, `FieldSchema`, `RuleCondition`).

**Additional model changes:**
- `User`: add `hubspotOwnerId String?` (SFDC users keep `sfdcUserId`; HubSpot users populate `hubspotOwnerId`)
- `RoundRobinTeam`, `TeamMember` — already generic, no changes needed
- `SfdcQueue` → rename to `CrmQueue`, add `crmQueueId String` for future flexibility

**Migration:** Prisma migration + backfill existing orgs as `crmType = SALESFORCE`.

---

### 2. New `packages/hubspot` Package

Mirror the structure of `packages/sfdc/src/`. Exports:

| Function | Purpose |
|----------|---------|
| `getHubSpotAuthUrl()` | OAuth 2.0 authorize URL (scopes: crm.objects.contacts.read/write, crm.objects.deals.read/write, crm.objects.companies.read/write, oauth) |
| `exchangeCodeForTokens(code)` | POST to HubSpot token endpoint |
| `refreshTokens(refreshToken)` | Token refresh |
| `createClient(tokens)` | HubSpot API client (use `@hubspot/api-client` npm package) |
| `fetchActiveOwners(client)` | GET /crm/v3/owners — returns users who can be assigned |
| `syncFieldSchema(client, orgId, objectType)` | GET /crm/v3/properties/{objectType} — maps to FieldSchema rows |
| `fetchRecord(client, objectType, objectId, properties[])` | GET full record with all properties for routing |
| `updateOwner(client, objectType, objectId, ownerId)` | PATCH /crm/v3/objects/{type}/{id} with `{ properties: { hubspot_owner_id: ownerId } }` |

HubSpot webhook signature: verify `X-HubSpot-Signature-v3` using HMAC-SHA256(clientSecret + httpMethod + url + body).

---

### 3. Engine — New HubSpot Route

**New file: `apps/engine/src/routes/hubspot-route.ts`**

HubSpot sends a **batch array** of subscription events, not a single record payload:
```json
[
  { "subscriptionType": "contact.creation", "portalId": 12345, "objectId": 67890, "occurredAt": 1700000000000 },
  { "subscriptionType": "deal.propertyChange", "portalId": 12345, "objectId": 11111, "occurredAt": 1700000001000 }
]
```

Key difference vs SFDC: **HubSpot does NOT send record fields in the webhook** — you must fetch them separately via the API.

**Handler flow:**
1. Verify `X-HubSpot-Signature-v3` HMAC signature
2. Find org by `portalId`
3. For each event in batch:
   a. Map `subscriptionType` → `objectType` (contact.creation → HS_CONTACT, INSERT)
   b. Idempotency check using `portalId:objectId:eventType:occurredAt`
   c. Fetch full record from HubSpot API (all properties needed for rule evaluation)
   d. Run `routeRecord(payload)` — **same router, same evaluator**
   e. Write back via `updateOwner()` from `packages/hubspot`

**New file: `apps/engine/src/hubspot.ts`** (mirror of `sfdc.ts`)
- Cache HubSpot API clients per org
- Token refresh logic
- `updateOwner()` delegation

**Retry queue worker** (`apps/engine/src/queue.ts`): Add HubSpot write-back branch — check `org.crmType`, call appropriate `updateOwner`.

---

### 4. Engine — Router Generalisation (`apps/engine/src/router.ts`)

Minor changes:
- `routeRecord` currently calls `sfdc.updateOwner` directly — extract to a `writeback(orgId, ...)` function that dispatches to SFDC or HubSpot based on `org.crmType`
- Object types in the rule filter need to include `HS_CONTACT | HS_DEAL | HS_COMPANY`

---

### 5. Web App — Auth (`apps/web/app/api/auth/`)

**New routes:**
- `GET /api/auth/hubspot` — redirect to `getHubSpotAuthUrl()`
- `GET /api/auth/hubspot/callback?code=xxx` — exchange code, upsert Organization with `crmType=HUBSPOT`, `hubspotPortalId`, tokens

**Login page** (`apps/web/app/(auth)/login/page.tsx`):
- Add a "Connect HubSpot" button alongside the existing "Connect Salesforce" button
- Two buttons side-by-side; clicking each initiates the respective OAuth flow
- No queue assignment option shown in the routing rules UI for HubSpot orgs

---

### 6. Web App — HubSpot-Specific API Routes

| Route | Purpose |
|-------|---------|
| `POST /api/fields/sync?object=HS_CONTACT` | Call `syncFieldSchema` from `packages/hubspot` |
| `POST /api/owners/sync` | Fetch HubSpot owners, upsert into `users` table |
| `GET /api/setup/status?hubspotPortalId=xxx` | Public endpoint for HubSpot onboarding polling |

---

### 7. Web App — Routing Rules UI

**Changes to `apps/web/app/(dashboard)/routing-rules/`:**
- Tabs: for SFDC orgs show LEAD | CONTACT | ACCOUNT; for HubSpot orgs show CONTACT | DEAL | COMPANY
- Assignment type QUEUE: **hidden for HubSpot orgs** — HubSpot v1 only supports USER and ROUND_ROBIN assignment types
- Field schema sync button — delegates to appropriate sync API based on `crmType`

---

### 8. HubSpot Webhook Subscription Setup

HubSpot webhooks are **app-level subscriptions** (not per-org like SFDC Named Credentials). You configure them in the HubSpot developer portal:
- Subscribe to: `contact.creation`, `contact.propertyChange`, `deal.creation`, `deal.propertyChange`, `company.creation`, `company.propertyChange`
- Target URL: `https://<ngrok-or-prod>/webhook/hubspot`
- Each installed portal (org) automatically has its events sent to this URL

This means the `/webhook/hubspot` endpoint must be **publicly accessible** and route based on `portalId` in the payload.

---

## Implementation Phases

### Phase A — Foundation (DB + HubSpot Package)
1. Prisma migration: add `CrmType`, `hubspotPortalId`, `hubspotAccessToken` etc. to `Organization`; rename `SfdcObjectType` → `ObjectType` with new HS_ variants; add `hubspotOwnerId` to `User`
2. Create `packages/hubspot` package: OAuth, token refresh, owners sync, field schema sync, `fetchRecord`, `updateOwner`
3. Update `packages/db` exports

### Phase B — Engine HubSpot Support
4. Add `apps/engine/src/hubspot.ts` (client cache + token refresh + updateOwner)
5. Add `apps/engine/src/routes/hubspot-route.ts` (batch event handler, signature verify, fetch-then-route)
6. Refactor `apps/engine/src/router.ts`: extract `writeback()` dispatcher, support HS_ object types
7. Refactor `apps/engine/src/queue.ts`: retry worker dispatches to correct `updateOwner` based on `crmType`
8. Register new route in `apps/engine/src/server.ts`: `POST /webhook/hubspot`

### Phase C — Web App
9. Add HubSpot OAuth routes (`/api/auth/hubspot`, `/api/auth/hubspot/callback`)
10. Add HubSpot-specific API routes (`/api/fields/sync` for HS types, `/api/owners/sync`)
11. Update login page: add HubSpot OAuth button
12. Update routing rules UI: dynamic tabs/options based on `crmType`
13. Update `proxy.ts` to inject `x-crm-type` header if needed

### Phase D — HubSpot App Config
14. Register HubSpot developer app, configure webhook subscriptions, add Client ID/Secret to env
15. Update ngrok/production to handle `/webhook/hubspot`

---

## Critical Files to Modify

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `CrmType`, HubSpot fields, rename enum |
| `apps/engine/src/routes/route.ts` | Minimal: ensure sfdcOrgId lookup is unchanged |
| `apps/engine/src/router.ts` | Extract `writeback()` dispatcher |
| `apps/engine/src/queue.ts` | Branch on `crmType` in retry worker |
| `apps/engine/src/server.ts` | Register `/webhook/hubspot` |
| `apps/web/app/(auth)/login/page.tsx` | Add HubSpot connect button |
| `apps/web/app/api/auth/hubspot/route.ts` | New: HubSpot OAuth redirect |
| `apps/web/app/api/auth/hubspot/callback/route.ts` | New: token exchange + org upsert |
| `apps/web/app/(dashboard)/routing-rules/page.tsx` | Dynamic tabs per CRM |

**New packages/files to create:**
- `packages/hubspot/` — full HubSpot client package
- `apps/engine/src/hubspot.ts` — engine-side HubSpot client cache
- `apps/engine/src/routes/hubspot-route.ts` — webhook handler

---

## Effort Estimate

| Phase | Scope |
|-------|-------|
| A — Foundation | Medium — DB migration + new npm package |
| B — Engine | Medium-High — new route, refactor dispatcher |
| C — Web App | Medium — auth + UI conditional rendering |
| D — HubSpot App Config | Low — portal settings |

**Total: ~3–5 days of focused engineering.**

---

## Verification Plan

1. **Unit test**: `packages/hubspot` — mock HubSpot API responses, test `fetchRecord`, `updateOwner`, signature verification
2. **Engine test**: POST to `/webhook/hubspot` with a sample batch payload (contact.creation), confirm it fetches record from HubSpot API mock, evaluates rules, and calls `updateOwner`
3. **End-to-end**: Create a HubSpot sandbox account, install the app, create a contact → confirm `hubspot_owner_id` is updated in HubSpot
4. **Regression**: Confirm existing SFDC `/route` endpoint still works unchanged

---

## Key HubSpot-Specific Gotchas

- **No inline fields in webhook**: Must call `/crm/v3/objects/{type}/{id}?properties=...` after receiving event. This adds ~100–200ms latency per record but is unavoidable.
- **Batch webhooks**: HubSpot sends up to 100 events per POST. Process them in `Promise.all()` but be mindful of HubSpot API rate limits (100 req/10s per token).
- **App-level subscriptions**: One HubSpot App handles all portals. No per-customer webhook setup required (unlike SFDC where each org needs a Named Credential).
- **Token refresh**: HubSpot access tokens expire in 30 minutes. Must refresh before each API call if expired.
- **Owner ID type**: HubSpot owner IDs are numeric strings (e.g., `"12345"`), not 18-char IDs.
- **Field names**: HubSpot uses snake_case (`firstname`, `company`, `dealname`) — no PascalCase issue like SFDC, but evaluator's case-fallback should still work.
