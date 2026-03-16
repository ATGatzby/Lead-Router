# Weighted Round Robin Distribution — Implementation Plan

> **STATUS: COMPLETED** (2026-03-14)
>
> All items in this plan have been implemented and are live. See `Architecture.md` section 21 for the full documentation.
>
> **What was delivered:**
> - `distributionType` column on `RoundRobinTeam` (`"round-robin"` | `"weighted"`, default `"round-robin"`)
> - `TeamMember.weight` field activated (was pre-existing but unused)
> - Engine: GCD-normalized deficit-based interleaving algorithm in `round-robin.ts` (`getNextWeightedMember()`) with separate `wrr:` Redis key prefix
> - Router: branches on `distributionType` in `resolveAssigneeFromFields()`
> - API: `PUT /api/teams/:id/weights` bulk weight endpoint + `distributionType` on all team CRUD endpoints + `weight` on member PATCH
> - UI: Distribution type picker cards, per-member weight sliders, percentage/points mode toggle, distribution preview bar, equalize button
> - Tests: Weighted RR unit tests covering GCD normalization, interleaving, proportional distribution

## Context

Teams currently support only simple (equal) round robin. The `TeamMember.weight` column already exists in the schema (`@default(1)`) but is unused — the engine's `round-robin.ts` ignores weights entirely. Users need the ability to choose between **equal round robin** and **weighted round robin** per team, and configure percentage or point-based weights per member when weighted mode is selected.

**Design reference:** [`weighted-distribution-prototype.html`](weighted-distribution-prototype.html) — interactive HTML prototype showing both modes with slider + input UI, distribution preview bar, and slot preview.

---

## Schema Changes

### File: `packages/db/prisma/schema.prisma`

Add `distributionType` to `RoundRobinTeam`:

```prisma
model RoundRobinTeam {
  id               String   @id @default(cuid())
  orgId            String
  name             String
  description      String?
  distributionType String   @default("round-robin") // "round-robin" | "weighted"
  pointerIndex     Int      @default(0)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  // ... relations unchanged
}
```

`TeamMember.weight` already exists (`Int @default(1)`) — no change needed.

### Migration

Create migration: `20260314100000_add_distribution_type`
```sql
ALTER TABLE "round_robin_teams" ADD COLUMN "distributionType" TEXT NOT NULL DEFAULT 'round-robin';
```

---

## Engine Changes

### File: `apps/engine/src/round-robin.ts`

Add `getNextWeightedMember()` alongside the existing `getNextMember()`.

**Algorithm:**
1. Normalize weights by GCD to keep slot array compact (e.g., [40,40,20] → GCD=20 → [2,2,1] → 5 slots)
2. Build interleaved slot array (spread evenly, not clustered)
3. Use same atomic Redis INCR + modulo pattern
4. Redis pointer mod total-slots → maps back to member

### File: `apps/engine/src/router.ts`

In `resolveAssigneeFromFields()` ROUND_ROBIN branch:
1. Fetch `distributionType` alongside team data
2. If `"weighted"` → call `getNextWeightedMember()`
3. If `"round-robin"` → call existing `getNextMember()`

---

## API Changes

| Endpoint | Method | Change |
|----------|--------|--------|
| `/api/teams` | GET | Include `distributionType` in list |
| `/api/teams` | POST | Accept optional `distributionType` (default: `"round-robin"`) |
| `/api/teams/:id` | GET | Include `distributionType` + `weight` per member |
| `/api/teams/:id` | PUT | Accept `distributionType` changes |
| `/api/teams/:id/members/:userId` | PATCH | Accept optional `weight` field |
| `/api/teams/:id/weights` | PUT | **NEW** — Bulk update weights |

### Weights Endpoint Spec

```json
PUT /api/teams/:id/weights
{
  "mode": "percentage",
  "weights": {
    "<userId>": 40,
    "<userId>": 40,
    "<userId>": 20
  }
}
```

Validation:
- Percentage mode: values must sum to 100
- Points mode: values must sum to 10
- All values ≥ 0, integers
- All userIds must be team members

---

## UI Changes

### Team Detail Page (`apps/web/app/(dashboard)/round-robins/[id]/page.tsx`)

1. **Distribution type picker** — Two cards (RR / Weighted) below header
2. **Weighted mode**: Slider + input per member, % / pts toggle, total validation, distribution bar, equalize button
3. **Round Robin mode**: Simple list with order numbers, equal share label
4. **Shared**: Pause/resume, add/remove members, stats, slot preview

### Team List Page (`apps/web/app/(dashboard)/round-robins/page.tsx`)

Add `distributionType` badge per team card.

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `distributionType` to RoundRobinTeam |
| `packages/db/prisma/migrations/20260314100000_add_distribution_type/` | New migration |
| `apps/engine/src/round-robin.ts` | Add `getNextWeightedMember()` |
| `apps/engine/src/router.ts` | Branch on `distributionType` in `resolveAssigneeFromFields()` |
| `apps/web/app/api/teams/route.ts` | Accept + return `distributionType` |
| `apps/web/app/api/teams/[id]/route.ts` | Accept + return `distributionType`, include `weight` per member |
| `apps/web/app/api/teams/[id]/weights/route.ts` | **NEW** — bulk weight update |
| `apps/web/app/api/teams/[id]/members/[userId]/route.ts` | Accept `weight` in PATCH |
| `apps/web/app/(dashboard)/round-robins/[id]/page.tsx` | Full distribution UI |
| `apps/web/app/(dashboard)/round-robins/page.tsx` | Distribution type badge |

---

## Implementation Order

1. Schema + migration
2. Engine (weighted RR algorithm + router integration)
3. API (team CRUD updates + weights endpoint)
4. UI (distribution picker, weighted controls, slot preview)
5. Tests

---

## Verification

1. Create team → defaults to "Round Robin"
2. Switch to "Weighted" → slider UI appears, set weights (40/40/20)
3. Save weights → API returns correct weights
4. Trigger routing → weighted distribution works (40% member gets ~2x vs 20%)
5. Pause member → effective % recalculates
6. Switch back to "Round Robin" → equal distribution resumes
7. Existing teams unchanged (backward compatible)
