# Phase 3 — Round Robin Teams

**Duration:** Week 2–3
**Status:** ⬜ Not Started
**Depends on:** Phase 1 (scaffold), Phase 2 (licensed users exist)

---

## Goal
Allow admins to create pools of licensed reps for fair, sequential lead distribution. When a routing rule targets a Round Robin team, the engine cycles through team members atomically — ensuring no two concurrent routing events assign to the same rep simultaneously.

---

## Deliverables
- [ ] Round Robin team CRUD (create, edit, delete with guard)
- [ ] Member management (add/remove licensed users, active/pause per member)
- [ ] Redis atomic pointer implementation (no duplicate assignments)
- [ ] Per-member assignment count display
- [ ] Team assignment history log
- [ ] Audit logging for team changes

---

## PRD Requirements Coverage

| ID | Requirement | Priority |
|---|---|---|
| RR-01 | Create named teams with description | P0 |
| RR-02 | Add any licensed user to one or more teams | P0 |
| RR-03 | Persist pointer; next record goes to next rep in sequence | P0 |
| RR-04 | Toggle member as Active or Paused within a team | P0 |
| RR-05 | Skip paused reps; resume seamlessly when re-activated | P0 |
| RR-06 | Per-member assignment count + percentage | P1 |
| RR-07 | Manual rotation reset with audit log | P1 |
| RR-08 | Weighted Round Robin (weight per member) | P2 — defer |
| RR-09 | Team assignment history log | P1 |
| RR-10 | Prevent deletion of team referenced by active routing rules | P0 |

---

## API Endpoints

```
GET    /api/teams                    → list all teams for org
POST   /api/teams                    → create new team
GET    /api/teams/:id                → team detail + members + stats
PUT    /api/teams/:id                → update team name/description
DELETE /api/teams/:id                → delete (guarded — must have no active rules)
POST   /api/teams/:id/members        → add users to team (body: { userIds: string[] })
DELETE /api/teams/:id/members/:userId → remove user from team
PATCH  /api/teams/:id/members/:userId → update member status (active/paused)
POST   /api/teams/:id/reset-pointer  → manually reset rotation to position 0
GET    /api/teams/:id/history        → team assignment history (last 100 events)
```

---

## Critical: Atomic Round Robin Pointer

The pointer determines who receives the next lead. Two concurrent routing events targeting the same team must NOT produce the same assignee.

**Solution: Redis Lua script (atomic INCR + modulo)**

```typescript
// apps/engine/src/round-robin.ts

import { redis } from './redis'

const POINTER_SCRIPT = `
  local key = KEYS[1]
  local count = tonumber(ARGV[1])
  if count == 0 then return -1 end
  local current = redis.call('INCR', key)
  return (current - 1) % count
`

export async function getNextMemberIndex(
  orgId: string,
  teamId: string,
  activeMembers: TeamMember[]
): Promise<TeamMember | null> {
  if (activeMembers.length === 0) return null

  const key = `rr:${orgId}:${teamId}:pointer`
  const index = await redis.eval(
    POINTER_SCRIPT,
    1,           // number of keys
    key,         // KEYS[1]
    String(activeMembers.length)  // ARGV[1]
  )

  if (index === -1) return null
  return activeMembers[index as number]
}

export async function resetPointer(orgId: string, teamId: string): Promise<void> {
  const key = `rr:${orgId}:${teamId}:pointer`
  await redis.set(key, 0)
}
```

**Why this works:**
- `INCR` is atomic in Redis — even 500 concurrent calls each get a unique incrementing number
- Modulo maps the ever-growing counter to a position in the active member array
- If a member is paused, the `activeMembers` array excludes them — they are simply not in the rotation
- If all members are paused, returns `null` → routing engine falls through to next rule or logs as unmatched

**Active member ordering:**
- Members are sorted by `createdAt ASC` (join order) to ensure consistent ordering
- Only `status = ACTIVE` members are passed to `getNextMemberIndex`

---

## Paused Member Handling

When a member is paused mid-cycle:
- Remove them from `activeMembers` array
- The pointer continues from its current position
- The paused member's slot is effectively skipped
- When re-activated, they re-enter the rotation at the end (or their original position — configurable in P2)

**Example:**
```
Team: [Alice, Bob, Carol]  (pointer = 5)
Carol pauses.
Active members: [Alice, Bob]
Next call: pointer becomes 6 → 6 % 2 = 0 → Alice
```

---

## UI Layout

### Teams List Page
```
Round Robin Teams                         [+ New Team]
─────────────────────────────────────────────────────
  ┌─────────────────────────────────────────────────┐
  │  West Coast SDRs                                │
  │  4 members · 3 active · 127 leads this month   │
  │  [Manage] [Edit] [Delete]                       │
  └─────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────┐
  │  Enterprise AEs                                 │
  │  3 members · 3 active · 42 leads this month    │
  │  [Manage] [Edit] [Delete]                       │
  └─────────────────────────────────────────────────┘
```

### Team Detail / Manage Page
```
West Coast SDRs                [Reset Rotation] [Edit]
─────────────────────────────────────────────────────
  Next up: Rahul Mehta (position 3 of 4)

  Member          Assigned   % Share   Status
  ──────────────────────────────────────────
  Priya Sharma    34         27%       [Active ●]
  Rahul Mehta     33         26%       [Active ●]
  Ananya Singh    32         25%       [Active ●]  ← next
  Dev Kumar       28         22%       [Paused ○]

  [+ Add Members]
```

---

## Delete Guard

Before deleting a team, check if any `RoutingRule` with `status = ACTIVE` references `assigneeTeamId = this team`:

```typescript
const activeRules = await prisma.routingRule.findMany({
  where: { assigneeTeamId: teamId, status: 'ACTIVE' }
})

if (activeRules.length > 0) {
  return 409 {
    error: 'Cannot delete team — referenced by active rules',
    rules: activeRules.map(r => ({ id: r.id, name: r.name }))
  }
}
```

---

## Key Files

| File | Purpose |
|---|---|
| `apps/web/app/(dashboard)/round-robins/page.tsx` | Teams list page |
| `apps/web/app/(dashboard)/round-robins/[id]/page.tsx` | Team detail / member management |
| `apps/web/app/api/teams/route.ts` | GET list, POST create |
| `apps/web/app/api/teams/[id]/route.ts` | GET, PUT, DELETE |
| `apps/web/app/api/teams/[id]/members/route.ts` | Add members |
| `apps/web/app/api/teams/[id]/members/[userId]/route.ts` | Update/remove member |
| `apps/web/app/api/teams/[id]/reset-pointer/route.ts` | Manual reset |
| `apps/engine/src/round-robin.ts` | Redis atomic pointer logic |

---

## Audit Log Entries

| Action | Trigger |
|---|---|
| `TEAM_CREATED` | New team created |
| `TEAM_UPDATED` | Name/description changed |
| `TEAM_DELETED` | Team deleted |
| `MEMBER_ADDED` | User added to team |
| `MEMBER_REMOVED` | User removed from team |
| `MEMBER_PAUSED` | Member status → PAUSED |
| `MEMBER_ACTIVATED` | Member status → ACTIVE |
| `POINTER_RESET` | Manual rotation reset |

---

## Verification Checklist
- [ ] Create a team, add 3 licensed members
- [ ] Simulate 9 routing events → each member receives exactly 3 (even distribution)
- [ ] Pause one member, simulate 6 more events → only active members receive leads
- [ ] Re-activate paused member, verify they re-enter rotation
- [ ] Attempt to delete a team referenced by an active rule → blocked with error
- [ ] Reset pointer → next assignment starts from first member
- [ ] Concurrent test: fire 20 routing events simultaneously → no duplicate assignments (check Redis counter)
- [ ] Audit log captures all member status changes
