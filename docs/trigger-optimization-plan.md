# Smart Trigger Optimization — Prevent Unnecessary Callouts

## Problem

When a lead is routed by the engine (INSERT event), the engine updates `OwnerId` via REST API. This fires Salesforce's `after update` trigger, which sends the lead **back** to the engine as an UPDATE event — wasted callout, confusing activity log, potential infinite loop.

**Three problems:**

1. **No update rules → wasted callouts**: Deploy route hardcodes all flags to `true`, so ALL updates fire
2. **Engine self-re-trigger**: Engine's OwnerId assignment fires update trigger → feedback loop
3. **Infinite loop risk**: Broad UPDATE rules match engine's own update → route → update → route → ...

---

## Industry Research

### LeanData (market leader)

- **Routing Action field stamp**: Custom text field on Lead/Contact/Account written by LeanData every time it acts (`"assigned"`, `"routed"`, `"merged-master"`). Trigger checks this field — if LeanData just stamped it, skip.
- **Recursive routing OFF by default**: Must be explicitly enabled by contacting support.
- **"Hold from Routing" checkbox**: Time-based cooldown after routing.
- **CCIO token pattern**: Trigger inserts a `CC_Inserted_Object__c` record; batch job processes it later. Decouples trigger from processing.

### Chili Piper

- Only changes owner if current owner doesn't comply with rules — avoids unnecessary re-assignments.

### Salesforce Best Practices

- **Never use static booleans** — break with bulk ops (200+ records) and partial success.
- **Static `Set<Id>`** — track processed records within a transaction (but doesn't persist across `@future`/REST API transactions).
- **Field-level change comparison** — check `Trigger.oldMap` vs `Trigger.newMap`, only process if relevant fields actually changed.
- **Cross-transaction**: Static variables don't persist. Only field stamps on the record work across transactions.

### Key Insight

Since our engine updates via REST API (separate Salesforce transaction), **static variables are useless**. The proven industry pattern is a **field stamp on the record** — the engine writes a marker when it assigns, and the trigger checks that field.

---

## Solution: Four Layers of Defense

### Layer 1 — Smart Flag Sync (web app → Salesforce)

When rules are created/updated/deleted, compute which `{Object}_{Event}_Enabled__c` flags should be true and sync to `lrt__Routing_Settings__c`. On fresh deploy with no rules, all flags = `false`.

```
For each objectType (LEAD, CONTACT, ACCOUNT):
  hasInsertRule = any ACTIVE rule where triggerEvent = INSERT or BOTH
  hasUpdateRule = any ACTIVE rule where triggerEvent = UPDATE or BOTH

  {Object}_Routing_Enabled__c = hasInsertRule OR hasUpdateRule
  {Object}_Insert_Enabled__c  = hasInsertRule
  {Object}_Update_Enabled__c  = hasUpdateRule
```

**Solves:** Problem 1. No update rules → flag false → zero update callouts.

### Layer 2 — Routing Action Field Stamp (LeanData pattern)

Add a custom field `Routing_Action__c` (Text) to each routable object (Lead, Contact, Account) in the managed package.

**Engine side:** After successful `updateOwner()`, also set `Routing_Action__c = "assigned"` on the record (same REST API call — just add the field to the update payload).

**Trigger side:** For UPDATE events, check if `Routing_Action__c` changed from blank/old-value to `"assigned"`. If the engine just stamped it, skip the record.

```apex
if (Trigger.isUpdate && settings.Lead_Update_Enabled__c) {
    for (Lead l : Trigger.new) {
        Lead old = Trigger.oldMap.get(l.Id);
        // Skip if engine just stamped this record
        if (l.Routing_Action__c != old.Routing_Action__c
            && l.Routing_Action__c == 'assigned') continue;
        updateIds.add(l.Id);
    }
}
```

**Why this works across transactions:** The field value persists on the record. The engine's REST API update sets `Routing_Action__c = "assigned"` AND `OwnerId = newOwner` in a single DML. The trigger sees the field changed to `"assigned"` and skips.

**Clearing the stamp:** The engine sets `Routing_Action__c` to a timestamped value like `"assigned:2026-03-12T14:30:00Z"` rather than just `"assigned"`. The trigger checks if `Routing_Action__c` changed AND starts with `"assigned"`. This way each routing creates a unique stamp — no collision with future routings of the same record.

**Solves:** Problems 2 and 3 completely. Engine's own updates are always recognized and skipped. Infinite loops broken.

### Layer 3 — Engine-Side Cooldown (safety net)

After successfully routing a record, set a Redis key `cooldown:${orgId}:${recordId}` with 30s TTL. Before processing any UPDATE event for the same record, check the key and skip if present.

**Solves:** Edge cases where Apex guard might not catch it. Defense in depth.

### Layer 4 — Observability & Proactive Alerting (catch breaches)

Detect when all three safeguards fail and proactively alert the user. This is the "circuit breaker" — even if recursion happens, we detect it, stop it, and tell the user.

**4a. New RoutingStatus values:**
Add `COOLDOWN_SKIPPED` and `STAMP_SKIPPED` to the `RoutingStatus` enum. When the engine skips a record due to cooldown (Layer 3) or detects it was engine-stamped, log it with these statuses instead of silently dropping.

**4b. Recursive detection in the engine:**
Before processing any record, check: has this `recordId` been routed (status=SUCCESS) within the last 60 seconds? If yes, this is a potential recursive bounce. Log it as `RECURSIVE_DETECTED` status with the original routing log ID linked. Process it anyway (it might be legitimate), but flag it.

```typescript
// In routeRecord(), before processing:
const recentRoute = await prisma.routingLog.findFirst({
  where: {
    orgId, sfdcRecordId: recordId, status: "SUCCESS",
    createdAt: { gte: new Date(Date.now() - 60_000) }
  },
  orderBy: { createdAt: "desc" }
});
if (recentRoute && eventType === "UPDATE") {
  // Flag this as a potential recursive bounce
  isRecursiveBounce = true;
}
```

**4c. Activity page — warning badges:**
On the Activity / Routing History page, show a warning icon next to entries where:
- Same `sfdcRecordId` appears 2+ times within 60 seconds
- Status is `COOLDOWN_SKIPPED`, `STAMP_SKIPPED`, or flagged as recursive bounce

Tooltip: "This record was routed multiple times in quick succession. This may indicate a recursive trigger loop."

**4d. Failed Routings tab — recursive section:**
Add a "Recursive Events" card to the Failed Routings tab showing:
- Count of recursive bounces detected in the last 24h / 7d
- Which records were affected
- Which rules triggered the recursion

**4e. Analytics dashboard — health metric:**
Add a "Trigger Health" KPI card to the Analytics Overview tab:
- "Recursive events: 0" (green) / "3 recursive events detected" (amber/red)
- "Cooldown skips: 12" (informational — Layer 3 working as expected)
- "Stamp skips: 0" (informational — Layer 2 working)

**4f. Proactive banner alert:**
If recursive events exceed a threshold (e.g., 5+ in 1 hour), show a persistent banner at the top of the dashboard:

> "⚠️ Recursive routing detected — {N} records were routed multiple times in the last hour. This usually means the routing engine's owner assignments are triggering update events. Check your UPDATE rules for overly broad conditions. [View affected records →]"

This banner appears on every page until dismissed or the issue resolves.

---

## Wireframe

The Trigger Health observability dashboard prototype is at:

**[`docs/trigger-health-prototype.html`](trigger-health-prototype.html)**

Open in browser to preview. Features:
- Health status banner (green/amber/red) with interactive demo switcher
- Three KPI cards: Cooldown Skips (L3), Stamp Skips (L2), Recursive Bounces
- Timeline chart showing routing events over the last hour with recursive bounces highlighted
- Recursive events table with 7 mock rows (color-coded: green = blocked, red = breached)
- Three safeguard status cards (Layer 1 / Layer 2 / Layer 3 health)
- Affected records accordion with full routing history per record

---

## Implementation

### Phase 1: Server-side (no Apex changes, immediate effect)

| # | File | Change |
|---|------|--------|
| 1 | `apps/web/lib/sync-routing-flags.ts` | **NEW** — query active rules, compute flags, update `lrt__Routing_Settings__c` |
| 2 | `apps/web/app/api/rules/route.ts` | Call `syncRoutingFlags()` after rule creation |
| 3 | `apps/web/app/api/rules/[id]/route.ts` | Call `syncRoutingFlags()` after PUT and DELETE |
| 4 | `apps/web/app/api/rules/[id]/clone/route.ts` | Call `syncRoutingFlags()` after clone |
| 5 | `apps/web/app/api/rules/[id]/status/route.ts` | Call `syncRoutingFlags()` after status toggle |
| 6 | `apps/web/app/api/integrations/salesforce/deploy/route.ts` | Replace hardcoded flags with `syncRoutingFlags()` |
| 7 | `apps/engine/src/cooldown.ts` | **NEW** — `setCooldown()` / `isInCooldown()` via Redis |
| 8 | `apps/engine/src/router.ts` | Check cooldown at top of `routeRecord()` for UPDATEs; set cooldown after `updateOwner()` |

### Phase 1b: Observability (engine + web app)

| # | File | Change |
|---|------|--------|
| 9 | `packages/db/prisma/schema.prisma` | Add `COOLDOWN_SKIPPED`, `STAMP_SKIPPED` to `RoutingStatus` enum |
| 10 | `apps/engine/src/router.ts` | Log `COOLDOWN_SKIPPED` / `STAMP_SKIPPED` entries; detect recursive bounces (same recordId routed within 60s) |
| 11 | `apps/web/app/(dashboard)/activity/page.tsx` | Warning badge on recursive entries |
| 12 | `apps/web/app/api/health/recursive/route.ts` | **NEW** — API endpoint returning recursive event count for last 1h/24h/7d |
| 13 | `apps/web/components/recursive-alert-banner.tsx` | **NEW** — Persistent banner shown when recursive threshold exceeded |
| 14 | `apps/web/app/(dashboard)/layout.tsx` | Include `RecursiveAlertBanner` in dashboard layout |
| 15 | `apps/web/app/(dashboard)/routing-rules/failed/page.tsx` | Add "Recursive Events" card |
| 16 | `apps/web/app/(dashboard)/analytics/page.tsx` | Add "Trigger Health" KPI card |

### Phase 2: Managed package update + engine update

| # | File | Change |
|---|------|--------|
| 17 | Lead, Contact, Account objects in managed package | Add `Routing_Action__c` field (Text 255) |
| 18 | `LeadTrigger.trigger` | Add `Routing_Action__c` check in update loop |
| 19 | `ContactTrigger.trigger` | Same |
| 20 | `AccountTrigger.trigger` | Same |
| 21 | `LeadTriggerTest.cls` | Add test: engine-stamped update skipped |
| 22 | `ContactTriggerTest.cls` | Same |
| 23 | `AccountTriggerTest.cls` | Same |
| 24 | `packages/sfdc/src/update-owner.ts` | Set `lrt__Routing_Action__c` alongside `OwnerId` |
| 25 | `apps/engine/src/router.ts` | Pass namespace-prefixed field to `updateOwner()` |

### Managed Package Custom Field

Add to each object (Lead, Contact, Account) in the managed package:

```xml
<!-- force-app/main/default/objects/Lead/fields/Routing_Action__c.field-meta.xml -->
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Routing_Action__c</fullName>
    <label>Routing Action</label>
    <type>Text</type>
    <length>255</length>
    <required>false</required>
    <description>Stamped by the routing engine when it assigns this record. Used to prevent recursive trigger firing.</description>
</CustomField>
```

Since these are on STANDARD objects (Lead, Contact, Account), they get the namespace prefix: `lrt__Routing_Action__c` in subscriber orgs.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Adding fields to Lead/Contact/Account in managed package | Medium | Standard pattern (LeanData does exactly this). Fields are optional, don't break existing workflows. |
| Flag sync fails (SFDC token expired) | Low | Fire-and-forget; corrected on next sync or deploy |
| Routing_Action__c field visible to users | Low | Can be hidden from page layouts; only used programmatically |
| Cooldown suppresses legitimate rapid re-route | Very Low | 30s window; only affects UPDATE for same record |
| Managed package update required for Layer 2 | Medium | Phase 1 (flag sync + cooldown) provides immediate protection without Apex changes |

---

## Verification

1. **Layer 1**: Create INSERT-only rule → verify `Lead_Update_Enabled__c = false`. Create lead → one event (INSERT only).
2. **Layer 1**: Create UPDATE rule → verify flag flips to `true`. Delete rule → verify flag flips back.
3. **Layer 2**: Create lead → engine routes (INSERT) → check `lrt__Routing_Action__c = "assigned:..."` on the lead. No UPDATE event in activity log.
4. **Layer 2**: Manually edit a lead's Status field → UPDATE event fires (Routing_Action__c didn't change to "assigned").
5. **Layer 3**: Check engine logs — `COOLDOWN_SKIPPED` entries for any edge cases.
6. **Layer 4**: Temporarily disable Layers 2+3 → create lead → verify recursive bounce is detected → warning badge appears on Activity page → banner shows after threshold.
7. **End-to-end**: Create INSERT + UPDATE rules → create lead → routed once on INSERT. Edit Status → routed on UPDATE. No recursive events. Activity page clean, no warnings.

---

## Sources

- [LeanData Routing Action Guide](https://leandatahelp.zendesk.com/hc/en-us/articles/360017782173-Routing-Routing-Action-Guide)
- [LeanData Technical Overview](https://leandatahelp.zendesk.com/hc/en-us/articles/360017618394-LeanData-Technical-Overview)
- [LeanData Recursive Routing](https://leandatahelp.zendesk.com/hc/en-us/articles/33882133954843-LeanData-Routing-Recursive-Routing)
- [LeanData Real-Time vs CCIO Processing](https://leandatahelp.zendesk.com/hc/en-us/articles/4413013162779-LeanData-Processing-Real-Time-Routing-vs-CCIO-Batch-Processing)
- [Don't Use Static Flags for Recursion — Nebula Consulting](https://nebulaconsulting.co.uk/insights/please-dont-use-static-flags-to-control-apex-trigger-recursion/)
- [Salesforce: Avoid Triggers Firing Twice](https://help.salesforce.com/s/articleView?id=000385126&language=en_US&type=1)
- [Apex Trigger Recursion POC Approaches (GitHub)](https://github.com/KrishnaKollu/poc-approaches-salesforce-trigger-recursion)
