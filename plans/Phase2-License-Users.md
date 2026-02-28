# Phase 2 — License Users Module

**Duration:** Week 1–2
**Status:** ✅ Complete
**Depends on:** Phase 1 (scaffold, auth, DB)

---

## Goal
Allow the Revenue Ops Admin to browse all active SFDC users in their connected org, license/de-license them individually or in bulk, and manage the seat count against their subscription. This is the entry point for all user management — no routing or Round Robin can function until users are licensed.

---

## Deliverables
- [ ] SFDC user sync (pull all active users from connected org)
- [ ] License Users page with search, filter, and table
- [ ] License toggle per user (individual)
- [ ] Bulk license/de-license action
- [ ] Real-time seat counter (`X of Y seats used`)
- [ ] Seat cap enforcement + upgrade prompt
- [ ] Auto-remove de-licensed users from Round Robin teams (cascade)
- [ ] Audit log for all licensing changes

---

## PRD Requirements Coverage

| ID | Requirement | Priority |
|---|---|---|
| LU-01 | Display all active SFDC users with name, email, role, profile | P0 |
| LU-02 | Toggle licensing ON/OFF per user | P0 |
| LU-03 | Real-time seat counter | P0 |
| LU-04 | Prevent licensing over seat count; show upgrade prompt | P0 |
| LU-05 | Bulk licensing | P1 |
| LU-06 | De-license removes user from all Round Robin teams | P0 |
| LU-07 | "Last Active" timestamp (last routed record) | P1 |
| LU-08 | Search and filter (name, role, department, profile) | P1 |
| LU-09 | On-demand sync + scheduled daily sync | P1 |
| LU-10 | Audit log all licensing changes | P0 |

---

## API Endpoints

```
GET  /api/users                   → paginated list of synced SFDC users
GET  /api/users/stats             → { seatsUsed, seatsPurchased }
POST /api/users/sync              → trigger on-demand SFDC user sync
POST /api/users/:id/license       → license a user (toggle ON)
POST /api/users/:id/de-license    → de-license a user (toggle OFF) + cascade RR removal
POST /api/users/bulk-license      → body: { userIds: string[], action: 'license' | 'de-license' }
```

---

## SFDC User Sync

**Query (jsforce):**
```javascript
// packages/sfdc/src/users.ts
const result = await conn.query(`
  SELECT Id, Name, Email,
         UserRole.Name, Profile.Name, Department,
         IsActive, LastLoginDate
  FROM User
  WHERE IsActive = true
  ORDER BY Name ASC
`)
```

**Sync logic:**
1. Fetch all active users from SFDC
2. Upsert into `users` table by `(orgId, sfdcUserId)` — update name/email/role/profile, don't touch `isLicensed`
3. Mark users no longer in SFDC as `isActive = false`
4. Update `Organization.updatedAt`

**Triggers:**
- On-demand: `POST /api/users/sync`
- Scheduled: Daily cron job (BullMQ scheduled job or Vercel cron)

---

## De-License Cascade Logic

When a user is de-licensed:
1. Set `users.isLicensed = false`
2. Find all `TeamMember` records for this user
3. Set each `TeamMember.status = PAUSED` (don't delete — preserve history)
4. Alert admin via response: `{ removedFromTeams: ['Team A', 'Team B'] }`
5. Write audit log entry

---

## UI Layout

```
License Users
─────────────────────────────────────────────────────
  [Sync Users ↻]                  ● 4 of 10 seats used
                          [Filter ▼]  [Search: name/email...]
─────────────────────────────────────────────────────
  □ Select All

  □  Priya Sharma           priya@acme.com
     Account Executive      Sales Profile
     Last Routed: 2h ago                          [Licensed ●]

  □  Rahul Mehta            rahul@acme.com
     SDR                    Sales Profile
     Last Routed: Yesterday                       [Licensed ●]

  □  Ananya Singh           ananya@acme.com
     SDR                    Sales Profile
     Last Routed: —                               [Unlicensed ○]

─────────────────────────────────────────────────────
  [License Selected (2)]   [De-License Selected]
```

**Seat counter behaviour:**
- Counter updates optimistically on toggle
- If licensing would exceed seat cap → block toggle, show modal:
  > "You've used all 10 seats. Upgrade your plan to license more users."
  > [Upgrade Plan] [Cancel]

---

## Key Files

| File | Purpose |
|---|---|
| `apps/web/app/(dashboard)/license-users/page.tsx` | Page component |
| `apps/web/app/(dashboard)/license-users/columns.tsx` | Table column definitions |
| `apps/web/app/api/users/route.ts` | GET list, POST sync |
| `apps/web/app/api/users/[id]/license/route.ts` | Toggle license |
| `apps/web/app/api/users/bulk-license/route.ts` | Bulk action |
| `packages/sfdc/src/users.ts` | jsforce SOQL query + sync logic |

---

## Audit Log Entries

Every licensing change writes to `AuditLog`:

```json
{
  "action": "USER_LICENSED",
  "entityType": "User",
  "entityId": "user_abc123",
  "beforeState": { "isLicensed": false },
  "afterState": { "isLicensed": true }
}
```

Actions: `USER_LICENSED`, `USER_DE_LICENSED`, `BULK_LICENSED`, `BULK_DE_LICENSED`

---

## Verification Checklist
- [ ] SFDC users appear in the table after sync
- [ ] Toggle licenses a user; seat counter increments
- [ ] Cannot license beyond seat cap — upgrade modal appears
- [ ] De-licensing a user who is in a Round Robin team shows which teams they were removed from
- [ ] Bulk select + license works for multiple users in one action
- [ ] Search by name filters the table in real time
- [ ] Audit log shows correct before/after state for each change
- [ ] Daily sync cron runs without errors
