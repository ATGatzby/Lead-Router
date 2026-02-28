# Phase 8 — India-Specific Features + Polish

**Duration:** Week 10–11
**Status:** ⬜ Not Started
**Depends on:** All previous phases (product functionally complete)

---

## Goal
Add India-market specific features that differentiate this product from RingLead/Lean Data for Indian customers, fix rough edges, validate performance targets, and prepare the MVP for real customer pilots.

---

## Deliverables
- [ ] INR pricing display + seat upgrade flow
- [ ] GST-ready invoice structure (placeholder for billing integration)
- [ ] WhatsApp webhook notification template
- [ ] Performance validation (500 concurrent events, <5s p95)
- [ ] Error boundaries and loading states throughout
- [ ] Onboarding checklist / progress indicator
- [ ] Empty states for all pages
- [ ] Final end-to-end smoke test

---

## 1. INR Pricing Display

The seat upgrade prompt currently shows a generic message. Replace with India-specific pricing:

**Seat upgrade modal:**
```
Upgrade Your Plan
─────────────────────────────────────────────────────
  You've used all 10 seats.

  ┌──────────────────┐  ┌──────────────────┐
  │   Starter        │  │   Growth         │
  │   ₹2,999/month   │  │   ₹6,999/month   │
  │   Up to 10 seats │  │   Up to 25 seats │
  │                  │  │   ★ Recommended  │
  │   [Select]       │  │   [Select]       │
  └──────────────────┘  └──────────────────┘

  All prices exclude GST (18%)
  Annual billing available — save 20%

  [Contact Sales]   [Cancel]
```

**Implementation:**
- Pricing plans defined in environment config (not hardcoded)
- Links to billing page / Razorpay checkout (billing integration is out of scope for MVP — use "Contact Sales" link to a Calendly/Google Form for now)

---

## 2. GST Invoice Structure

Indian B2B SaaS requires GST-compliant invoices. For MVP, create a `billing` settings page stub with the right fields collected:

**Billing Settings page collects:**
- Legal entity name
- GST Identification Number (GSTIN)
- Registered address (line 1, line 2, city, state, PIN code)
- Contact email for invoices

Even if actual invoice generation is handled by a billing tool (Razorpay, Chargebee), collecting this data now means no re-work later.

**Schema addition:**
```prisma
model BillingInfo {
  id           String @id @default(cuid())
  orgId        String @unique
  entityName   String
  gstin        String?
  addressLine1 String?
  addressLine2 String?
  city         String?
  state        String?
  pinCode      String?
  invoiceEmail String?
  updatedAt    DateTime @updatedAt

  org          Organization @relation(fields: [orgId], references: [id])
}
```

---

## 3. WhatsApp Notification Webhook Template

Indian sales teams run on WhatsApp, not Slack. When a routing event webhook fires (RE-09, P2 — implementing a basic version here), provide a pre-built WhatsApp payload template.

**In Settings → Notifications → Webhook URL:**
```
Webhook URL: [https://api.example.com/whatsapp-notify ]

Payload Preview (WhatsApp Cloud API format):
{
  "messaging_product": "whatsapp",
  "to": "{{rep_phone}}",
  "type": "template",
  "template": {
    "name": "lead_assigned",
    "language": { "code": "en_IN" },
    "components": [{
      "type": "body",
      "parameters": [
        { "type": "text", "text": "{{rep_name}}" },
        { "type": "text", "text": "{{record_id}}" },
        { "type": "text", "text": "{{object_type}}" }
      ]
    }]
  }
}

Available variables: {{rep_name}}, {{rep_email}}, {{record_id}},
{{object_type}}, {{rule_name}}, {{timestamp}}
```

**Implementation:**
- After a successful routing, engine fires a POST to the configured webhook URL
- Payload uses the template with variable substitution
- Webhook failures are non-blocking (don't affect routing success/failure)
- Timeout: 3 seconds max

---

## 4. Performance Validation

Before customer pilots, validate the p95 latency and concurrency targets from the PRD.

**Load test script (using k6 or Artillery):**
```javascript
// load-test/routing-load-test.js
import http from 'k6/http'
import { check } from 'k6'

export const options = {
  vus: 500,        // 500 virtual users
  duration: '60s', // for 1 minute
}

export default function () {
  const payload = JSON.stringify({
    orgId: 'test_org',
    objectType: 'LEAD',
    eventType: 'INSERT',
    recordId: `00Q${Math.random().toString(36).substr(2, 15)}`,
    timestamp: new Date().toISOString(),
    fields: { LeadSource: 'Web', AnnualRevenue: 150000 },
  })

  const start = Date.now()
  const res = http.post(
    'http://localhost:3001/route',
    payload,
    { headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': 'sha256=...' } }
  )
  const duration = Date.now() - start

  check(res, {
    'status is 200': (r) => r.status === 200,
    'latency < 5000ms': () => duration < 5000,
  })
}
```

**Targets to validate:**
- p95 response time < 5000ms ✓
- 0 errors (no 4xx/5xx) ✓
- Round Robin: no duplicate assignments across 500 concurrent events ✓
- Redis memory stays bounded (no leak from pointer keys) ✓

---

## 5. Error Boundaries + Loading States

Audit every page for missing error handling:

**Error boundary pattern (Next.js):**
```tsx
// apps/web/app/(dashboard)/error.tsx
'use client'
export default function Error({ error, reset }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
      <p className="text-muted-foreground">Something went wrong loading this page.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
```

**Pages needing skeleton loaders:**
- License Users (user table skeleton)
- Round Robins (team card skeletons)
- Routing Rules (rule list skeleton)
- Routing History (table row skeletons)

---

## 6. Onboarding Checklist

A progress indicator in the sidebar or on the dashboard to guide new customers to go-live:

```
Getting Started                              3 of 5 complete
─────────────────────────────────────────────────────
  ✅  Connect Salesforce org
  ✅  License your first user
  ✅  Create a Round Robin team
  ○   Create your first routing rule
  ○   Activate routing for Lead object

                                    [View Setup Guide →]
```

**Implementation:**
- Computed from DB state (org connected? any licensed users? any teams? any active rules? any active triggers?)
- Dismissed per org after all steps complete
- Visible in sidebar until 5/5 complete

---

## 7. Empty States

Pages need helpful empty states (not blank screens) for new customers:

| Page | Empty State Message |
|---|---|
| License Users | "No users synced yet. Click 'Sync Users' to import your Salesforce team." |
| Round Robins | "No teams yet. Create a team to start distributing leads fairly." |
| Routing Rules | "No rules configured. Create your first rule to start routing leads." |
| Routing History | "No routing events yet. Routing history will appear here once records are routed." |
| Failed Routings | "No failures. Your routing is running smoothly." (success state with green icon) |

---

## 8. Final Smoke Test Checklist

Run through the complete user journey before customer pilots:

**Admin setup flow:**
- [ ] Fresh install → SFDC OAuth → land on dashboard
- [ ] Onboarding checklist shows 1/5 complete after OAuth
- [ ] Sync SFDC users → user list populates
- [ ] License 3 users → seat counter updates
- [ ] Create a Round Robin team with 3 members
- [ ] Sync Lead field schema
- [ ] Create a routing rule (Lead Source = "Web" → Round Robin team)
- [ ] Create a catch-all fallback rule
- [ ] Test Rule with matching JSON → correct match shown
- [ ] Deploy SFDC package to Developer org
- [ ] Create Lead in SFDC (LeadSource = "Web")
- [ ] Routing event appears in History within 5 seconds
- [ ] Lead Owner in SFDC updated to correct rep
- [ ] Create 9 more Leads → each of 3 reps receives exactly 3 (even distribution)
- [ ] Pause one rep → next 3 Leads go to remaining 2 reps only
- [ ] De-license a user → removed from team, admin notified
- [ ] CSV export → download and verify data

---

## Key Files

| File | Purpose |
|---|---|
| `apps/web/app/(dashboard)/settings/billing/page.tsx` | Billing + GST info |
| `apps/web/app/(dashboard)/settings/notifications/page.tsx` | Webhook + WhatsApp template |
| `apps/web/components/onboarding-checklist.tsx` | Progress indicator |
| `apps/web/app/(dashboard)/error.tsx` | Dashboard error boundary |
| `load-test/routing-load-test.js` | k6 load test script |

---

## Post-MVP Roadmap (v2 Hints)

These are out of scope for v1 but worth noting for planning:

| Feature | Priority |
|---|---|
| AI/ML lead scoring + predictive routing | P1 v2 |
| Territory management (geographic routing by state/city) | P1 v2 |
| HubSpot + Zoho CRM integration | P1 v2 |
| Match-all rules (multi-assignment) | P1 v2 |
| Rep availability / working hours routing | P2 v2 |
| SLA tracking per rep | P2 v2 |
| Native mobile app | P3 v2 |
