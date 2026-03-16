# License Users — UX Redesign

## Problem

The current License Users page uses a confusing 2-step modal popup (triggered by "Sync Users" button):
1. Step 1: Choose licensing mode (All / Individual / By Role / By Profile) + trigger SFDC sync
2. Step 2: Confirm selections in the same modal

Issues:
- Users don't understand what "Sync Users" does — it conflates sync + licensing
- Modal is cramped and hard to discover
- Only 4 methods supported; customers need 5 (+ Queues, + Custom Field)
- Queues are fundamentally different — they're routing targets, not users consuming seats

## Redesign

**Wireframe reference**: `license-users-redesign.html` (project root)

### Key UX Changes

1. **No modals anywhere** — everything is in-page
2. **No "Sync Users" button** — sync happens automatically / on page load
3. **5 method cards** at the top of the Users tab — the primary action surface
4. **Searchable dropdown** replaces static chip lists — scales to hundreds of roles/queues
5. **Live match count** updates as selections are made
6. **2 tabs only**: Users (main) and Overview (stats/timeline)

### Page Layout

#### Header (always visible)
- Title: "License Users"
- Subtitle: "Choose how to license Salesforce users for routing."
- Right side: Salesforce Connected badge + seat counter pill ("10 / 50 seats")

#### Tab 1: Users (default)

**Method Selector** — 5 cards in a grid row:

| Card | Behavior | Seat Impact |
|------|----------|-------------|
| **Individual Users** | Searchable dropdown of all users; already-licensed shown as disabled | 1 seat per user |
| **By Role** | Searchable dropdown of SFDC roles; shows user count per role | 1 seat per matched user |
| **By Profile** | Searchable dropdown of SFDC profiles; shows user count per profile | 1 seat per matched user |
| **By Queue** | Searchable dropdown of SFDC queues; shows member count as context | **Does NOT consume seats** — queues are licensed as routing targets |
| **By Custom Field** | Searchable dropdown of boolean User custom fields | 1 seat per matched user |

Each card shows a **badge count** of currently licensed items via that method.

**Selection Panel** — slides down when a method card is clicked:
- Searchable multi-select dropdown with:
  - Color-coded selected tags (removable with ×)
  - Checkbox per option in dropdown
  - User count / member count per option
  - "Already licensed" indicator for Individual mode
- Live preview: `[3] users will be licensed · 5 already licensed`
- Button updates dynamically: "License 3 Users" / "License 2 Queues"
- Cancel button closes panel

**User Table** — below the selection panel:
- Columns: Checkbox | User (name + email) | Role / Profile | Department | Teams | Last Routed | Licensed (badge + toggle) | Actions (trash)
- Filter bar: Search input, License status dropdown, Department dropdown
- Inline toggle to license/de-license individual users
- Bulk action bar (fixed bottom): License Selected, De-License Selected, Delete Selected, Clear
- Pagination

#### Tab 2: Overview

- **Seat Usage** — SVG circular gauge showing used/total seats with animated arc
- **Breakdown by Method** — 5 stat cards (Individual, By Role, By Profile, Queues Licensed, By Custom Field)
- **Active Licensing Methods** — compact table showing method, values, user count, status
- **Recent Activity** — vertical timeline of licensing events

### Queue Licensing — Special Behavior

Queues are **NOT users**. When licensing by Queue:
- The queue entity itself becomes a valid routing target
- No user seats are consumed
- Dropdown shows "N members" as context but doesn't license the members
- Preview says "2 queues will be licensed" (not users)
- Button says "License 2 Queues"
- Overview stat card says "Queues Licensed"

### API Changes Required

#### New Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/users/license-by-role` | POST | `{ roles: string[] }` — license all users matching roles |
| `/api/users/license-by-profile` | POST | `{ profiles: string[] }` — license all users matching profiles |
| `/api/users/license-by-custom-field` | POST | `{ fieldName: string }` — license users where field is true |
| `/api/queues/license` | POST | `{ queueIds: string[] }` — mark queues as licensed routing targets |
| `/api/queues/de-license` | POST | `{ queueIds: string[] }` — remove queue licensing |

#### Schema Changes

```prisma
model SfdcQueue {
  // ... existing fields ...
  isLicensed  Boolean  @default(false)   // NEW: whether queue can receive routed records
}

model User {
  // ... existing fields ...
  licensedVia  String?  // NEW: "individual" | "role" | "profile" | "custom_field" — how user was licensed
}
```

#### Existing Endpoints (unchanged)
- `GET /api/users` — paginated user list
- `POST /api/users/[id]/license` — single user license
- `POST /api/users/[id]/de-license` — single user de-license
- `POST /api/users/bulk-license` — bulk license/de-license
- `DELETE /api/users/[id]` — delete user
- `POST /api/users/bulk-delete` — bulk delete
- `GET /api/users/filters` — distinct roles/profiles
- `GET /api/users/stats` — seat usage

### Files to Modify

| File | Change |
|------|--------|
| `apps/web/app/(dashboard)/license-users/page.tsx` | Complete rewrite — remove modal, add method cards + searchable dropdown + tabs |
| `packages/db/prisma/schema.prisma` | Add `isLicensed` to SfdcQueue, add `licensedVia` to User |
| `apps/web/app/api/users/license-by-role/route.ts` | NEW — bulk license by role |
| `apps/web/app/api/users/license-by-profile/route.ts` | NEW — bulk license by profile |
| `apps/web/app/api/users/license-by-custom-field/route.ts` | NEW — license by custom field |
| `apps/web/app/api/queues/license/route.ts` | NEW — queue licensing |
| `apps/web/app/api/queues/de-license/route.ts` | NEW — queue de-licensing |
| `apps/web/app/api/users/stats/route.ts` | Update to include licensedVia breakdown + queue count |
| `Architecture.md` | Document the redesign |
| `Technical-Implementation.md` | Update License Users section |

### Verification

1. Open License Users page — should show 5 method cards, no Sync Users button
2. Click "By Role" — searchable dropdown opens, type to filter, select roles
3. Live count updates as roles are selected
4. Click "License N Users" — users get licensed, table updates, seat count updates
5. Click "By Queue" — select queues, preview says "queues" not "users", no seat change
6. Toggle individual user license via table — works as before
7. Bulk select + License/De-License — works as before
8. Overview tab — gauge animates, stats show breakdown by method
9. De-licensing a user pauses their Round Robin team memberships (existing behavior preserved)
