# Plan: Admin Portal + Subscription Tiers

## Context
The app currently has a single hardcoded tier (5 seats, no routing quota). Every new org gets `seatsPurchased: 5` at OAuth callback, with no plan concept, no routing limits, and no admin visibility into customers. This plan adds:
1. A FREE/PAID tier system with seat and monthly routing quota enforcement
2. An internal `/admin` portal for managing orgs (activation, plan, seats, DB reset)

---

## Phase 1 — DB Schema Changes
**File:** `packages/db/prisma/schema.prisma`

Add `Plan` enum and 4 new fields to `Organization`:

```prisma
enum Plan {
  FREE
  PAID
}

model Organization {
  // ... existing fields ...
  plan             Plan     @default(FREE)
  isActive         Boolean  @default(true)
  routingQuotaUsed Int      @default(0)
  quotaResetAt     DateTime @default(now())
}
```

- `plan`: FREE or PAID — drives seat cap and routing quota limit
- `isActive`: false = org suspended (engine rejects 403, web redirects to /suspended)
- `routingQuotaUsed`: running monthly counter, incremented per successful routing
- `quotaResetAt`: lazy reset — when engine sees `quotaResetAt < now`, it resets counter and sets next month's date

**Run:** `pnpm --filter @lead-routing/db db:migrate && pnpm --filter @lead-routing/db db:generate`

---

## Phase 2 — Tier Constants (shared package)
**New file:** `packages/db/src/plan-limits.ts`

```ts
export const PLAN_LIMITS = {
  FREE: { seats: 5, routingLeadsPerMonth: 100 },
  PAID: { seats: 20, routingLeadsPerMonth: 1000 },
};
export function getPlanLimits(plan: "FREE" | "PAID") { return PLAN_LIMITS[plan]; }
```

**New file:** `packages/db/src/constants.ts`
```ts
export const RULES_INVALIDATE_CHANNEL = "rules:invalidate";
```

**Modify:** `packages/db/src/index.ts` — export both new files

Both the engine and web app already import from `@lead-routing/db`, so no new package needed. Engine uses workspace package alias (no `.js` extension needed for package imports).

---

## Phase 3 — Engine Quota Enforcement
**Modify:** `apps/engine/src/routes/route.ts`

Expand the org `select` to include `plan`, `isActive`, `routingQuotaUsed`, `quotaResetAt`.

Insert after HMAC validation, **before** idempotency check:

```
Step 2.5a — isActive check: if false → return 403 { error: "Organization is suspended" }
Step 2.5b — Lazy quota reset: if org.quotaResetAt < now → UPDATE routingQuotaUsed=0, quotaResetAt=startOfNextMonth()
Step 2.5c — Quota gate: if quotaUsed >= PLAN_LIMITS[plan].routingLeadsPerMonth → return 429 { error: "quota_exceeded", plan, limit, used }
```

After `routeRecord()` returns `"routed"` or `"dry_run"` (not `"unmatched"`):
```ts
// Increment quota counter (atomic DB increment, no race condition)
await prisma.organization.update({
  where: { id: orgId },
  data: { routingQuotaUsed: { increment: 1 } },
});
```

Note: dry_run routings do NOT count toward quota (they're test-only, not real lead routing).

**Modify:** `apps/engine/src/queue.ts`
- In `routingWorker.on("completed")`: also increment quota for the org (retry-routed lead)
- Job data already has `orgId`

---

## Phase 4 — Web App Tier Wiring

### 4a. OAuth Callback
**Modify:** `apps/web/app/api/auth/callback/route.ts`

Replace hardcoded `seatsPurchased: 5` in `create` block:
```ts
import { getPlanLimits } from "@lead-routing/db";
const freeLimits = getPlanLimits("FREE");
// in create:
seatsPurchased: freeLimits.seats,  // 5
plan: "FREE",
isActive: true,
routingQuotaUsed: 0,
quotaResetAt: startOfNextMonth(),  // helper: first day of next month UTC
```
Leave `update` block unchanged (re-login should not reset plan).

### 4b. Billing API
**Modify:** `apps/web/app/api/settings/billing/route.ts`

Add to org `select`: `plan`, `routingQuotaUsed`, `quotaResetAt`.
Return in GET response:
```ts
{
  billing: { ... },
  seats: { seatsPurchased, seatsUsed },
  quota: {
    plan,
    routingQuotaUsed,
    routingQuotaLimit: getPlanLimits(plan).routingLeadsPerMonth,
    quotaResetAt,
    quotaPercent: Math.round((routingQuotaUsed / limit) * 100),
  }
}
```

### 4c. Auth Me
**Modify:** `apps/web/app/api/auth/me/route.ts` — add `plan` to the response

### 4d. Suspended Org Redirect
**Modify:** `apps/web/proxy.ts`

Add Redis-based suspended check. After decrypting the session (line 38+), before injecting headers:
```ts
import { isOrgSuspended } from "@/lib/org-status";

if (session.orgId && await isOrgSuspended(session.orgId)) {
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Org suspended" }, { status: 403 });
  if (!pathname.startsWith("/suspended")) return NextResponse.redirect(new URL("/suspended", req.url));
}
```

**New file:** `apps/web/lib/org-status.ts`
```ts
// Redis key: org:suspended:{orgId} — set on deactivate, deleted on activate
export async function isOrgSuspended(orgId: string): Promise<boolean>
export async function setOrgSuspended(orgId: string): Promise<void>
export async function clearOrgSuspended(orgId: string): Promise<void>
```

**New file:** `apps/web/app/(dashboard)/suspended/page.tsx` — "Your account has been suspended. Contact support."

Also add to `PUBLIC_PREFIXES` in proxy.ts: `"/suspended"`, `"/admin"`, `"/api/admin/"`.

---

## Phase 5 — Admin Portal

### 5a. Auth Helper
**New file:** `apps/web/lib/admin-auth.ts`

Two functions:
- `signAdminToken(secret: string): string` — returns `"${timestamp}.${hmac-sha256}"`
- `validateAdminToken(token: string | undefined): boolean` — rejects if missing, malformed, or older than 8 hours; uses `crypto.timingSafeEqual`

Env var required: `ADMIN_SECRET` (add to `.env.local`)

### 5b. Proxy Admin Guard
**Modify:** `apps/web/proxy.ts` — add at the top of `proxy()`, before `PUBLIC_PREFIXES` check:

```ts
if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin/")) {
  // /admin/login and /api/admin/auth/ are always public
  if (pathname === "/admin/login" || pathname.startsWith("/api/admin/auth/")) {
    return NextResponse.next();
  }
  const adminToken = req.cookies.get("admin_token")?.value;
  if (!validateAdminToken(adminToken)) {
    return pathname.startsWith("/api/admin/")
      ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
      : NextResponse.redirect(new URL("/admin/login", req.url));
  }
  return NextResponse.next();
}
```

### 5c. Route Structure

```
apps/web/app/
├── (admin)/                          ← route group (no URL prefix collision)
│   └── admin/
│       ├── login/page.tsx            ← password form → POST /api/admin/auth/login
│       ├── layout.tsx                ← admin shell: header + sign-out button
│       ├── page.tsx                  ← redirect to /admin/orgs
│       └── orgs/
│           ├── page.tsx              ← org list table
│           └── [id]/page.tsx         ← org detail + actions

apps/web/app/api/admin/
├── auth/
│   ├── login/route.ts                ← POST: validate ADMIN_SECRET, set cookie
│   └── logout/route.ts               ← POST: clear admin_token cookie
└── orgs/
    ├── route.ts                      ← GET: list all orgs with stats
    └── [id]/
        ├── route.ts                  ← GET: single org detail
        ├── activate/route.ts         ← POST: isActive=true + clearOrgSuspended()
        ├── deactivate/route.ts       ← POST: isActive=false + setOrgSuspended()
        ├── plan/route.ts             ← PUT: { plan } → update plan + seatsPurchased to plan default
        ├── seats/route.ts            ← PUT: { seatsPurchased } → override seats
        └── reset/route.ts            ← POST: { mode: "soft"|"hard" }
```

### 5d. Admin API Details

**GET `/api/admin/orgs`** — returns all orgs:
```ts
prisma.organization.findMany({
  orderBy: { createdAt: "desc" },
  select: { id, sfdcOrgId, plan, isActive, seatsPurchased, seatsUsed,
            routingQuotaUsed, quotaResetAt, createdAt,
            billingInfo: { select: { entityName: true } } }
})
// enrich with quotaLimit = getPlanLimits(org.plan).routingLeadsPerMonth
```

**POST `/api/admin/orgs`** — manually pre-provision a customer org:

```ts
// Request body:
{
  sfdcOrgId: string,        // 15–18 char Salesforce Org ID (required)
  sfdcInstanceUrl: string,  // must start with https:// (required)
  entityName?: string,      // company/customer name (optional)
  plan?: "FREE" | "PAID",   // defaults to "FREE"
  seatsPurchased?: number,  // optional override (defaults to plan default: 5 or 20)
}
```

Creates the org with:
- `oauthAccessToken: ""` and `oauthRefreshToken: ""` — filled when customer logs in via Salesforce OAuth
- `webhookSecret`: auto-generated via `generateWebhookSecret()` — customer copies this into Salesforce Custom Setting
- Optional `billingInfo.entityName` via nested Prisma create
- Returns `409 Conflict` if an org with the same `sfdcOrgId` already exists

**POST `/api/admin/orgs/[id]/reset`** — `{ mode: "soft" | "hard" }`

*Soft reset:* Delete `routing_logs` + reset `routingQuotaUsed=0, quotaResetAt=startOfNextMonth()` (single transaction)

*Hard reset:* Prisma transaction in FK-safe order:
1. `ruleCondition.deleteMany` (via nested: `rule: { orgId }`)
2. `routingRule.deleteMany`
3. `teamMember.deleteMany` (via `team: { orgId }`)
4. `roundRobinTeam.deleteMany`
5. `routingLog.deleteMany`
6. `auditLog.deleteMany`
7. `fieldSchema.deleteMany`
8. `sfdcQueue.deleteMany`
9. `user.deleteMany`
10. `organization.update` → reset `seatsUsed=0, routingQuotaUsed=0, onboardingDone=false, quotaResetAt=startOfNextMonth()`

After hard reset: publish Redis cache invalidation for all 3 object types:
```ts
const redis = getRedis();
for (const t of ["LEAD", "CONTACT", "ACCOUNT"]) {
  await redis.publish(RULES_INVALIDATE_CHANNEL, JSON.stringify({ orgId: id, objectType: t }));
}
```

**`BillingInfo` is preserved** — org record is updated, not deleted.

### 5e. Admin UI Pages

**`/admin/login/page.tsx`** — client component, password field, POSTs to `/api/admin/auth/login`, redirects to `/admin/orgs` on 200.

**`/admin/orgs/page.tsx`** — client component (React Query), table with columns:
| Customer | Plan | Seats | Routing Quota | Status | Created | Actions |
- Plan: badge (FREE = muted, PAID = primary)
- Seats: `seatsUsed / seatsPurchased`
- Quota: `routingQuotaUsed / quotaLimit` with progress bar
- Status: Active (green) / Suspended (red)
- Actions: link to detail page
- Header: **"+ New Customer"** button opens `NewCustomerDialog`

**`NewCustomerDialog`** (inline in `orgs/page.tsx`) — form for manually provisioning an org before a customer logs in via OAuth:
| Field | Required | Notes |
|-------|----------|-------|
| Salesforce Org ID | ✓ | 15–18 char, from SF Setup → Company Information |
| Instance URL | ✓ | `https://myorg.salesforce.com` |
| Entity / Company Name | — | Stored in `billingInfo.entityName` |
| Invite Email | — | Stored in `billingInfo.invoiceEmail`; triggers Resend welcome email |
| Plan | — | FREE (default) or PAID |
| Seats | — | Optional override; defaults to plan default (5 / 20) |

On submit: `POST /api/admin/orgs` → invalidates `["admin-orgs"]` React Query cache → table refreshes.
If `inviteEmail` was provided, a Resend welcome email is sent with a link to `/login`. Email failure is non-fatal — org is still created and 201 returned.

**`/admin/orgs/[id]/page.tsx`** — client component, 5 sections:
1. Org Info (sfdcOrgId, entityName, invoice email, createdAt)
2. Plan & Seats (dropdown FREE/PAID, number input for seats override)
3. Quota usage bar + reset date
4. Status toggle (Activate / Suspend)
5. Danger Zone: Soft Reset + Hard Reset buttons (each behind confirmation dialog)

---

## Phase 6 — Tier UX (Customer-Facing)

### 6a. QuotaBanner Component
**New file:** `apps/web/components/quota-banner.tsx`

Client component using React Query to fetch `/api/settings/billing`.
- Hidden if `quotaPercent < 80`
- Amber warning at 80–99%: "You've used X% of your routing quota this month. Resets [date]."
- Red blocking banner at 100%: "Monthly routing limit reached. Leads are paused until [date]." + Upgrade button

**Modify:** `apps/web/app/(dashboard)/layout.tsx` — insert `<QuotaBanner />` between `<Topbar />` and `<main>`.

### 6b. Upgrade Modal
**Modify:** `apps/web/components/upgrade-modal.tsx`

- Replace placeholder plan data with actual FREE/PAID limits from `PLAN_LIMITS`
- Add `context?: "seats" | "quota"` prop to change headline copy
- Upgrade CTA: **contact/email link** (no payment integration — admin manually upgrades plan)

### 6c. Settings Page
**Modify:** `apps/web/app/(dashboard)/settings/page.tsx`

Add "Routing Quota" section alongside existing seats section:
- Progress bar colored by `quotaPercent` (green < 80, amber 80–99, red 100)
- Shows `routingQuotaUsed / quotaLimit` leads
- "Resets on [quotaResetAt formatted date]"
- Upgrade CTA when at 100%

---

## Files Summary

### Create (24 files)
| File | Purpose |
|------|---------|
| `packages/db/src/plan-limits.ts` | Tier constants |
| `packages/db/src/constants.ts` | `RULES_INVALIDATE_CHANNEL` |
| `packages/db/prisma/migrations/<ts>_add_plan_quota/` | Generated migration |
| `apps/web/lib/admin-auth.ts` | Admin token sign/validate |
| `apps/web/lib/org-status.ts` | Redis suspended org flag |
| `apps/web/app/(admin)/admin/login/page.tsx` | Admin login |
| `apps/web/app/(admin)/admin/layout.tsx` | Admin shell |
| `apps/web/app/(admin)/admin/page.tsx` | Redirect to /admin/orgs |
| `apps/web/app/(admin)/admin/orgs/page.tsx` | Org list table |
| `apps/web/app/(admin)/admin/orgs/[id]/page.tsx` | Org detail + actions |
| `apps/web/app/api/admin/auth/login/route.ts` | Set admin cookie |
| `apps/web/app/api/admin/auth/logout/route.ts` | Clear admin cookie |
| `apps/web/app/api/admin/orgs/route.ts` | GET: list orgs, POST: create org |
| `apps/web/app/api/admin/orgs/[id]/route.ts` | Single org |
| `apps/web/app/api/admin/orgs/[id]/activate/route.ts` | Activate org |
| `apps/web/app/api/admin/orgs/[id]/deactivate/route.ts` | Deactivate org |
| `apps/web/app/api/admin/orgs/[id]/plan/route.ts` | Change plan |
| `apps/web/app/api/admin/orgs/[id]/seats/route.ts` | Override seats |
| `apps/web/app/api/admin/orgs/[id]/reset/route.ts` | Soft/hard reset |
| `apps/web/app/(dashboard)/suspended/page.tsx` | Suspended org page |
| `apps/web/components/quota-banner.tsx` | Quota warning banner |

### Modify (10 files)
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `Plan` enum + 4 org fields |
| `packages/db/src/index.ts` | Export plan-limits + constants |
| `apps/engine/src/routes/route.ts` | isActive gate + quota check + increment |
| `apps/engine/src/queue.ts` | Increment quota in worker "completed" |
| `apps/web/proxy.ts` | Admin guard + suspended org redirect |
| `apps/web/app/api/auth/callback/route.ts` | Seed plan/quota fields on org create |
| `apps/web/app/api/auth/me/route.ts` | Include `plan` in response |
| `apps/web/app/api/settings/billing/route.ts` | Include quota data in GET response |
| `apps/web/app/(dashboard)/layout.tsx` | Add `<QuotaBanner />` |
| `apps/web/app/(dashboard)/settings/page.tsx` | Add routing quota section |
| `apps/web/components/upgrade-modal.tsx` | Real tier data + context prop |
| `Technical-Implementation.md` | Document all new modules |

---

## Key Design Decisions
- **Quota increment in `route.ts`** (not `router.ts`) — org object already in scope, cleaner separation
- **Dry-run excluded from quota** — test routings don't count against monthly limit
- **Upgrade = contact-based** — admin manually changes plan in admin portal; no Stripe
- **Suspended org check = Redis flag** — fast path in proxy, avoids DB round-trip per request; fail-open if Redis down
- **Hard reset preserves BillingInfo + org record** — only data is deleted, org can re-onboard
- **Admin token = stateless HMAC** — no DB session; validated in proxy.ts
- **Manual org creation** — admin can pre-provision orgs before a customer logs in via OAuth; OAuth tokens are left empty and filled on first login; webhook secret is auto-generated and must be copied into Salesforce Custom Setting (`Routing_Settings__c.Webhook_Secret__c`)

## Verification
1. Run `pnpm db:migrate` — confirm migration succeeds, 4 new columns visible in psql
2. Create org via SFDC OAuth login — confirm `plan=FREE, isActive=true, routingQuotaUsed=0` in DB
3. Route 100 leads via Postman → 101st should return `429 quota_exceeded`
4. Admin portal: `GET /admin/login` → login with ADMIN_SECRET → view org list → change plan to PAID → confirm seatsPurchased becomes 20
5. Admin deactivate org → next routing webhook returns 403 → main app redirects to /suspended
6. Admin hard reset → all rules/users/logs gone, billing info intact
7. Settings page shows quota bar; at 100% shows red banner + upgrade CTA
