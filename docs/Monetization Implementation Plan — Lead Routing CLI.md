# Monetization Implementation Plan — Lead Routing CLI

## Context
Lead Routing is self-hosted via `npx @lead-routing/cli init`. Currently **zero payment gates**. We're adding a 2-tier model (Free + Pro $999/year) with heavy enforcement (CLI + container + heartbeat).

## Decisions
- **Tiers**: Free (2 rules, 1 org, 3 seats, Lead only) + Pro ($999/year, $500 renewal, everything unlimited)
- **Enforcement**: CLI gate + container startup phone-home + weekly heartbeat
- **License server**: Cloudflare Worker + D1 ($0/month)
- **Payments**: Stripe subscriptions (test mode for dev)
- **Marketing site**: openedgeai.tech

---

## Phase 1: License Server (Cloudflare Worker + D1)

**New repo/project**: `license-server/` (Cloudflare Worker)

### D1 Schema
```sql
CREATE TABLE licenses (
  id TEXT PRIMARY KEY,                    -- uuid
  key TEXT NOT NULL UNIQUE,               -- LR-XXXX-XXXX-XXXX-XXXX
  jwt TEXT NOT NULL,                      -- signed Ed25519 JWT (for offline validation)
  email TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'pro',       -- 'free' | 'pro'
  stripeCustomerId TEXT,
  stripeSubscriptionId TEXT,
  validUntil TEXT NOT NULL,               -- ISO date (1 year from purchase)
  graceUntil TEXT,                        -- 30 days after validUntil if lapsed
  serverFingerprint TEXT,                 -- bound to first server that activates
  lastHeartbeat TEXT,                     -- ISO datetime
  isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL DEFAULT (datetime('now')),
  updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### API Endpoints

**POST /v1/licenses/validate**
```
Input:  { key: string, fingerprint?: string }
Output: { valid: boolean, tier: "free"|"pro", validUntil: string, graceActive: boolean }
Logic:
  1. Look up license by key
  2. Check validUntil (or graceUntil if lapsed)
  3. If fingerprint provided and no serverFingerprint set → bind it
  4. If fingerprint doesn't match → reject (license tied to different server)
  5. Return tier + validity
```

**POST /v1/licenses/heartbeat**
```
Input:  { key: string, fingerprint: string, version: string, activeUsers: number }
Output: { valid: boolean, tier: string, validUntil: string }
Logic:
  1. Validate license (same as above)
  2. Update lastHeartbeat timestamp
  3. If subscription lapsed > 30 days → return { valid: true, tier: "free" }
```

**POST /v1/licenses/create** (Stripe webhook only)
```
Input:  Stripe checkout.session.completed event
Logic:
  1. Extract customer email + subscription ID
  2. Generate license key (LR-XXXX-XXXX-XXXX-XXXX format)
  3. Sign JWT with Ed25519 private key: { tier, validUntil, key }
  4. Insert into D1
  5. Send license key email via Resend API
```

**POST /v1/stripe/webhook** (Stripe events)
```
Events handled:
  - checkout.session.completed → create license
  - invoice.paid → extend validUntil by 1 year
  - customer.subscription.deleted → set graceUntil = now + 30 days
```

### Key Generation
- Format: `LR-XXXX-XXXX-XXXX-XXXX` (alphanumeric, easy to copy/paste)
- JWT payload: `{ key, tier, validUntil }` signed with Ed25519
- Public key embedded in Docker images for offline verification

### Files to Create
```
license-server/
├── wrangler.toml           -- Cloudflare Worker config
├── src/
│   ├── index.ts            -- Router (Hono or itty-router)
│   ├── routes/validate.ts  -- POST /v1/licenses/validate
│   ├── routes/heartbeat.ts -- POST /v1/licenses/heartbeat
│   ├── routes/webhook.ts   -- POST /v1/stripe/webhook
│   ├── lib/keys.ts         -- Ed25519 sign/verify, key generation
│   ├── lib/db.ts           -- D1 queries
│   └── lib/email.ts        -- Resend API for license delivery
├── schema.sql              -- D1 migration
└── package.json
```

---

## Phase 2: Stripe Integration

### Requirements (all free for test mode)
1. Create Stripe account at stripe.com
2. Get test API keys (`sk_test_...` / `pk_test_...`)
3. Create a Product + Price in Stripe dashboard:
   - Product: "Lead Routing Pro"
   - Price: $999/year recurring (first year), $500/year recurring (renewal — use Stripe's pricing tiers or a second price)
4. Set up Checkout Session creation in license server
5. Configure webhook endpoint in Stripe dashboard → `https://license-api.openedgeai.tech/v1/stripe/webhook`

### Stripe Checkout Flow
```
openedgeai.tech/pricing → "Get Pro" button
  → POST to license server /v1/checkout/create
  → Creates Stripe Checkout Session (mode: "subscription", price: $999/year)
  → Redirects to Stripe-hosted checkout page
  → Customer pays with test card 4242 4242 4242 4242
  → Stripe redirects to openedgeai.tech/success?session_id=xxx
  → Webhook fires → license server creates key → emails it
```

### Files to Add (in license-server/)
```
src/routes/checkout.ts      -- POST /v1/checkout/create (creates Stripe Checkout Session)
```

---

## Phase 3: CLI License Step

### Changes to Existing Files

**`apps/cli/src/commands/init.ts`** — Add license step as new Step 1 (shift all others +1)
```typescript
// Before Step 1 (prerequisites), add:
const licenseResult = await validateLicenseStep()
// licenseResult: { tier: "free" | "pro", key?: string }
// Pass tier info to collect-config and generate-files steps
```

**`apps/cli/src/utils/config.ts`** — Add fields to InstallConfig interface
```typescript
// Add to InstallConfig:
licenseKey?: string
licenseTier: 'free' | 'pro'
```

**`apps/cli/src/templates/env-web.ts`** — Add to WebEnvConfig + output
```typescript
// Add to interface:
licenseKey?: string
licenseTier: string

// Add to renderEnvWeb output:
LICENSE_KEY=${c.licenseKey ?? ''}
LICENSE_TIER=${c.licenseTier}
LICENSE_API_URL=https://license-api.openedgeai.tech
```

**`apps/cli/src/templates/env-engine.ts`** — Same treatment
```typescript
// Add to interface + output:
LICENSE_KEY=${c.licenseKey ?? ''}
LICENSE_TIER=${c.licenseTier}
LICENSE_API_URL=https://license-api.openedgeai.tech
```

### New Files

**`apps/cli/src/steps/validate-license.ts`**
```typescript
// Step flow:
// 1. Prompt: "Enter license key (or press Enter for free tier)"
// 2. If key entered → POST to license API /v1/licenses/validate
// 3. If valid → return { tier: response.tier, key }
// 4. If invalid → show error, re-prompt
// 5. If Enter (no key) → return { tier: "free" }
// Uses @clack/prompts for UI consistency
```

**`apps/cli/src/utils/license.ts`**
```typescript
export const LICENSE_API_URL = 'https://license-api.openedgeai.tech'

export async function validateLicense(key: string): Promise<LicenseInfo>
  // POST /v1/licenses/validate { key }
  // Returns { valid, tier, validUntil }

export function formatTierBadge(tier: string): string
  // Returns colored badge: "[FREE]" or "[PRO]"
```

---

## Phase 4: Container Startup Checks

### Web App — `apps/web/docker-entrypoint.sh`
**Current** (15 lines): migrations → seed → start Next.js

**Add before migrations:**
```bash
# License validation (phone-home with offline fallback)
if [ -n "$LICENSE_KEY" ]; then
  echo "[entrypoint] Validating license..."
  RESP=$(curl -sf --max-time 10 "${LICENSE_API_URL}/v1/licenses/validate" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"${LICENSE_KEY}\",\"fingerprint\":\"$(hostname)\"}" \
    2>/dev/null || echo '{"valid":false,"offline":true}')

  VALID=$(echo "$RESP" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{console.log(JSON.parse(d).valid)}catch{console.log('false')}")
  OFFLINE=$(echo "$RESP" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{console.log(JSON.parse(d).offline||false)}catch{console.log('true')}")

  if [ "$VALID" = "false" ] && [ "$OFFLINE" = "true" ]; then
    echo "[entrypoint] License server unreachable, verifying offline..."
    # Offline JWT verification happens in Node (public key embedded)
    node apps/web/verify-license.js "$LICENSE_KEY"
    if [ $? -ne 0 ]; then
      echo "[entrypoint] License invalid. Purchase at https://openedgeai.tech/pricing"
      exit 1
    fi
  elif [ "$VALID" = "false" ]; then
    echo "[entrypoint] License invalid or expired. Renew at https://openedgeai.tech/account"
    echo "[entrypoint] Starting in FREE tier mode..."
    export LICENSE_TIER="free"
  fi
else
  echo "[entrypoint] No license key — running in FREE tier"
  export LICENSE_TIER="free"
fi
```

### New File — `apps/web/verify-license.js`
```javascript
// Offline license verification using Ed25519 public key
// 1. Decode JWT from LICENSE_KEY
// 2. Verify signature against embedded public key
// 3. Check validUntil date
// 4. Exit 0 if valid, exit 1 if invalid
```

### Engine — `apps/engine/src/server.ts`
**Add to `start()` function, before `app.listen()`:**
```typescript
// License check on startup
const licenseKey = process.env.LICENSE_KEY
const licenseTier = process.env.LICENSE_TIER ?? 'free'
if (licenseKey) {
  try {
    const res = await fetch(`${process.env.LICENSE_API_URL}/v1/licenses/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: licenseKey, fingerprint: os.hostname() })
    })
    const data = await res.json()
    if (!data.valid) {
      console.warn('[license] License invalid, running in FREE tier')
      process.env.LICENSE_TIER = 'free'
    }
  } catch {
    console.warn('[license] License server unreachable, using offline verification')
    // Offline JWT verify with embedded public key
  }
}
```

---

## Phase 5: Feature Gating in Web App

### Approach
Create a server-side helper `getLicenseTier()` that reads from env + DB, then gate at the API level.

### New File — `apps/web/src/lib/license.ts`
```typescript
export type LicenseTier = 'free' | 'pro'

export interface TierLimits {
  maxRules: number        // free: 2, pro: Infinity
  maxOrgs: number         // free: 1, pro: 1
  maxSeats: number        // free: 3, pro: Infinity
  allowedTriggers: string[] // free: ['LEAD'], pro: ['LEAD','CONTACT','ACCOUNT']
  weightedDistribution: boolean
  analytics: boolean
  auditLog: boolean
}

export function getTierLimits(tier: LicenseTier): TierLimits

export function getLicenseTier(): LicenseTier
  // Returns process.env.LICENSE_TIER || 'free'
```

### API Routes to Gate

| Route | File | Gate Logic |
|-------|------|-----------|
| `POST /api/rules` | `apps/web/app/api/rules/route.ts` | Count existing rules. If >= 2 and tier=free → 402 with upgrade message |
| `POST /api/rules` | same | Check `objectType`. If not LEAD and tier=free → 402 |
| `POST /api/rules/[id]/clone` | `apps/web/app/api/rules/[id]/clone/route.ts` | Same rule count check |
| `POST /api/users/[id]/license` | `apps/web/app/api/users/[id]/license/route.ts` | Count licensed users. If >= 3 and tier=free → 402 |
| `POST /api/users/bulk-license` | `apps/web/app/api/users/bulk-license/route.ts` | Same seat check |
| `PUT /api/teams/[id]/weights` | `apps/web/app/api/teams/[id]/weights/route.ts` | If tier=free → 402 "Weighted distribution requires Pro" |
| `POST /api/teams` (with weighted) | `apps/web/app/api/teams/route.ts` | If distributionType=weighted and tier=free → 402 |
| `GET /api/analytics/*` | `apps/web/app/api/analytics/` (all routes) | If tier=free → 402 "Analytics requires Pro" |
| `GET /api/audit-logs` | `apps/web/app/api/audit-logs/route.ts` | If tier=free → 402 "Audit logs require Pro" |

### UI Gating
Add tier-aware components in the dashboard:

| Page | File | Gate |
|------|------|------|
| Rules list | `apps/web/app/(dashboard)/routing-rules/page.tsx` | Show "2/2 rules used" badge + upgrade CTA if at limit |
| New rule form | `apps/web/app/(dashboard)/routing-rules/new/page.tsx` | Disable Contact/Account triggers with lock icon + "Pro" badge |
| Teams page | `apps/web/app/(dashboard)/round-robins/page.tsx` | Show "Pro" badge on weighted distribution option |
| Weights editor | `apps/web/app/(dashboard)/round-robins/[id]/page.tsx` | Disable weight sliders with upgrade overlay |
| Analytics | `apps/web/app/(dashboard)/analytics/page.tsx` | Show blurred preview with "Upgrade to Pro" overlay |
| Audit logs | `apps/web/app/(dashboard)/activity/audit/page.tsx` | Same blurred preview treatment |
| Users page | `apps/web/app/(dashboard)/users/page.tsx` | Show "3/3 seats used" + upgrade CTA |

### New UI Component
**`apps/web/src/components/upgrade-banner.tsx`**
- Reusable banner/overlay: "This feature requires Pro. Upgrade at openedgeai.tech/pricing"
- Used across all gated pages

### New API Route
**`apps/web/app/api/license/route.ts`** — `GET /api/license`
- Returns current tier, limits, usage counts (rules, seats, orgs)
- Used by dashboard UI to show tier badges and limits

---

## Phase 6: Heartbeat System

### Engine Heartbeat Job
**New file: `apps/engine/src/license-heartbeat.ts`**

Follow the pattern from `analytics-queue.ts`:
```typescript
// Create dedicated queue: "license-heartbeat"
// Repeatable job: runs every 7 days (pattern: "0 0 * * 0" — Sunday midnight)
// Job handler:
//   1. POST /v1/licenses/heartbeat { key, fingerprint, version, activeUsers }
//   2. If response.tier !== current tier → update LICENSE_TIER env
//   3. If response.valid === false → log warning, set grace flag
//   4. Store lastHeartbeat + response in Redis for dashboard display
```

**Register in `apps/engine/src/server.ts`:**
```typescript
import "./license-heartbeat.js" // Side-effect: starts heartbeat worker
// In start(): initLicenseHeartbeat(redisUrl)
```

### Grace Period Logic
- Heartbeat response includes `graceActive: true` if subscription lapsed but within 30 days
- After 30 days grace: heartbeat returns `tier: "free"` → engine updates env → web app reads new tier
- **Data is never deleted** — existing rules/users beyond free limits become read-only

### Web App License Status
**New file: `apps/web/app/api/license/status/route.ts`**
- Reads last heartbeat result from Redis (set by engine)
- Returns: `{ tier, validUntil, lastHeartbeat, graceActive, daysRemaining }`
- Dashboard settings page shows license status card

---

## Phase 7: Marketing Site — openedgeai.tech

**Tech stack**: Next.js 15 (static export) or Astro, deployed on Vercel/Cloudflare Pages

### Pages
```
openedgeai.tech/
├── /                    -- Hero, product overview, how-it-works, social proof
├── /pricing             -- Free vs Pro comparison table, "Get Started Free" + "Get Pro" CTAs
├── /account             -- Stripe Customer Portal embed (manage subscription, view invoices)
├── /account/license     -- View license key, copy to clipboard, server binding info
├── /docs                -- Quick start guide, FAQ, troubleshooting
├── /docs/setup          -- Step-by-step CLI setup guide
└── /success             -- Post-checkout "License key sent!" confirmation
```

### Pricing Page Flow
```
"Get Started Free" → links to docs (npx @lead-routing/cli init)
"Get Pro — $999/year" → Stripe Checkout → /success → email with license key
```

### Key Components
- **PricingTable** — 2-column Free vs Pro comparison (mirrors the tier table above)
- **CheckoutButton** — Calls license server `/v1/checkout/create`, redirects to Stripe
- **LicenseCard** — Shows masked key (LR-XXXX-****-****-XXXX), copy button, server binding status
- **AccountPortal** — Stripe Customer Portal for subscription management

---

## Phase 8: Go Live Checklist

1. Swap Stripe test keys (`sk_test_`) for live keys (`sk_live_`)
2. Complete Stripe business verification
3. Verify webhook endpoint works with live events
4. Update license server `LICENSE_API_URL` in env templates
5. Deploy marketing site to openedgeai.tech
6. Rebuild Docker images with embedded Ed25519 public key
7. Push new images to GHCR
8. Update CLI package on npm
9. Test full flow: purchase → key → init → deploy → heartbeat

---

## Stripe Integration — Requirements & Testing

**Requirements (all free):**
1. Free Stripe account (no credit card needed to sign up)
2. Test API keys (`sk_test_...` / `pk_test_...`) — available immediately
3. Stripe Checkout (hosted payment page — Stripe handles UI + PCI compliance)
4. Webhook endpoint on Cloudflare Worker

**Testing ($0 — no real money):**
- Use test card `4242 4242 4242 4242` + any future expiry + any CVC
- Full simulation: subscriptions, renewals, cancellations, webhooks — all work in test mode
- Switch to live: just swap test keys for live keys when ready
- Simulate subscription lifecycle: create → renew → cancel → re-subscribe

**Webhooks needed:**
- `checkout.session.completed` → create license key + send email
- `invoice.paid` → extend `validUntil` by 1 year
- `customer.subscription.deleted` → start 30-day grace period

---

## Subscription Lapse Behavior

- Heartbeat detects expired subscription → sets `licenseTier = "free"` locally
- **30-day grace period**: Full Pro features continue for 30 days after expiry (gives time to renew)
- After grace: app enforces free tier limits (2 rules, 3 seats, Lead triggers only)
- **Data never deleted**: Existing rules/users beyond free limits become read-only, not removed
- Re-subscribing instantly restores Pro tier on next heartbeat

---

## Payment Integration

- **Stripe Subscriptions** for annual billing ($999 first year, $500/year renewal)
- **Stripe Customer Portal** for self-service (cancel, update payment method, view invoices)
- **Webhooks**:
  - `checkout.session.completed` → create license key + send email
  - `invoice.paid` → extend license `validUntil` by 1 year
  - `customer.subscription.deleted` → mark license for downgrade (grace period starts)
- **Landing page**: Pricing page at `openedgeai.tech/pricing`

---

## Existing Code to Reuse

| What | Where | How to Reuse |
|------|-------|-------------|
| Plan enum (FREE/PAID) | `schema.prisma` Organization model line 95 | Map LICENSE_TIER to existing plan field |
| Seats enforcement | `apps/web/app/api/users/[id]/license/route.ts` | Already checks seatsPurchased vs seatsUsed — wire to tier limits |
| Routing quota check | `apps/engine/src/routes/route.ts` line 96-98 | Already enforces quotas — connect to tier |
| BullMQ repeatable job pattern | `apps/engine/src/analytics-queue.ts` lines 237-314 | Clone pattern for license heartbeat |
| @clack/prompts UI | `apps/cli/src/steps/collect-config.ts` | Use same prompt patterns for license step |
| Resend email | Already in stack (env var `RESEND_API_KEY`) | Use for license key delivery emails |

---

## Verification Plan

### Unit Tests
- License key generation: valid format, unique, signed JWT verifiable
- Offline verification: valid JWT passes, expired JWT fails, tampered JWT fails
- Tier limits: `getTierLimits('free')` returns correct limits

### Integration Tests
- **CLI**: `init` with no key → deploys in free tier → verify LICENSE_TIER=free in .env
- **CLI**: `init` with valid key → deploys in pro tier → verify LICENSE_KEY in .env
- **CLI**: `init` with invalid key → rejected, re-prompted
- **Container startup**: Remove LICENSE_KEY from .env → restart → starts in free tier
- **Container startup**: Invalid key + license server down → offline JWT check
- **Feature gating**: Free tier → create 3rd rule → 402 response
- **Feature gating**: Free tier → create 4th seat → 402 response
- **Feature gating**: Free tier → create weighted team → 402 response
- **Heartbeat**: Simulate expired subscription → after 30 days grace → tier becomes free
- **Stripe**: Test card 4242... → checkout completes → webhook fires → key created

### E2E Smoke Test
```
1. Buy Pro on openedgeai.tech (test mode, fake card)
2. Receive license key email
3. Run: npx @lead-routing/cli init → paste key
4. Deploy to VPS → verify Pro features work
5. Create unlimited rules, seats, weighted teams → all succeed
6. Cancel Stripe subscription → wait for heartbeat → verify grace period
7. After 30 days (simulate) → verify downgrade to free limits
```
