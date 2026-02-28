# Phase 6 — Routing History & Audit Log

**Duration:** Week 7–8
**Status:** ⬜ Not Started
**Depends on:** Phase 5 (routing engine writing logs to DB)

---

## Goal
Give Revenue Ops teams a complete, searchable record of every routing decision. They need to debug failed routings, verify fair distribution across reps, export data for reporting, and see a full audit trail of every configuration change.

---

## Deliverables
- [ ] Routing history table with full filtering
- [ ] Per-rep assignment count dashboard (today / week / month)
- [ ] Failed routings panel with inline Retry action
- [ ] CSV export of routing history
- [ ] Config audit log viewer (all licensing + rule changes)

---

## Routing History Page

### Columns
| Column | Description |
|---|---|
| Record ID | SFDC record ID — links directly to the record in Salesforce |
| Object | Lead / Contact / Account |
| Event | Insert / Update |
| Rule Matched | Rule name (or "No match" for UNMATCHED) |
| Assignee | User name or team name |
| Mode | User / Round Robin / Queue |
| Timestamp | When the routing event occurred |
| Status | SUCCESS / FAILED / UNMATCHED / RETRY badge |

### Filters
- Date range picker (from / to)
- Object type (Lead / Contact / Account / All)
- Status (Success / Failed / Unmatched / All)
- Assignee (search by name)
- Rule (dropdown of all rules)

### UI Sketch
```
Routing History
──────────────────────────────────────────────────────────────────
Date: [Last 7 days ▼]  Object: [All ▼]  Status: [All ▼]  Assignee: [Search...]
                                                        [Export CSV ↓]
──────────────────────────────────────────────────────────────────
Record ID      Object   Rule                   Assignee        Time       Status
00Q5g00001     Lead     Enterprise Inbound     Priya Sharma    10:32 AM   ✅ Success
00Q5g00002     Lead     SMB Web Leads          Rahul Mehta     10:31 AM   ✅ Success
00Q5g00003     Lead     —                      —               10:30 AM   ⚠ Unmatched
00Q5g00004     Contact  Contact Fallback       SDR Team B      10:28 AM   🔴 Failed   [Retry]
──────────────────────────────────────────────────────────────────
  Showing 4 of 1,247 events                [← Prev]  Page 1  [Next →]
```

---

## Per-Rep Assignment Stats

A summary panel at the top of the History page (or its own sub-tab):

```
Assignment Summary — This Month (Feb 2026)
──────────────────────────────────────────────────────
Rep              Leads   Contacts   Accounts   Total
──────────────────────────────────────────────────────
Priya Sharma     42      8          3          53
Rahul Mehta      41      9          2          52
Ananya Singh     40      7          4          51
Dev Kumar        38      6          3          47
──────────────────────────────────────────────────────
                 [Today]  [This Week]  [This Month]  [Custom Range]
```

---

## Failed Routings Panel

Failures need to be surfaced prominently. When the DLQ has entries, show a banner:

```
  ⚠ 3 routing failures need attention    [View Failed Routings]
```

Failed Routings panel:
```
Failed Routings
──────────────────────────────────────────────────────
Record ID      Object   Attempted     Error                  Action
00Q5g00004     Lead     3 retries     SFDC API timeout       [Retry] [Dismiss]
00Q5g00011     Contact  3 retries     Invalid OwnerId        [Retry] [Dismiss]
──────────────────────────────────────────────────────
```

**Retry action:**
- Re-evaluates the routing rule against the original payload
- If rule still matches, re-attempts SFDC OwnerId update
- Updates log status back to `RETRY` → then `SUCCESS` or `FAILED` again

---

## CSV Export

`GET /api/routing-logs/export?from=2026-02-01&to=2026-02-28&object=LEAD&status=SUCCESS`

Returns a CSV file with columns:
```
Record ID, Object, Event Type, Rule Name, Assignee Name, Assignment Mode, Timestamp, Status, Error Message
```

- Streamed response (don't load all rows into memory)
- Max 100,000 rows per export; show warning if filter exceeds limit
- Filename: `routing-history-{date}.csv`

---

## Config Audit Log

A separate tab showing all configuration changes made by admins:

```
Config Audit Log
──────────────────────────────────────────────────────────────────────
Date/Time        Actor           Action                   Entity
──────────────────────────────────────────────────────────────────────
Feb 23, 10:42    Arun Tyagi      Rule activated           Enterprise Inbound Leads
Feb 23, 10:38    Arun Tyagi      User licensed            Priya Sharma
Feb 23, 10:35    Ravi Kumar      Team member paused       West Coast SDRs / Dev Kumar
Feb 23, 10:20    Arun Tyagi      Rule created             SMB Web Leads
──────────────────────────────────────────────────────────────────────
  [Filter by actor]  [Filter by action type]  [Export CSV]
```

Clicking a row expands to show before/after JSON diff for the changed entity.

---

## API Endpoints

```
GET  /api/routing-logs              → paginated list (with filter params)
GET  /api/routing-logs/export       → CSV stream
GET  /api/routing-logs/failed       → failed + unmatched logs only
GET  /api/routing-logs/stats        → per-rep counts for time period
POST /api/routing-logs/:id/retry    → re-enqueue failed routing to BullMQ
POST /api/routing-logs/:id/dismiss  → mark failed as dismissed (remove from failed panel)
GET  /api/audit-logs                → config audit log (paginated, filterable)
```

---

## Database Queries

**Per-rep stats for a time period:**
```sql
SELECT
  u.name,
  rl.object_type,
  COUNT(*) as assignment_count
FROM routing_logs rl
JOIN users u ON u.sfdc_user_id = rl.assignee_id
WHERE rl.org_id = $orgId
  AND rl.status = 'SUCCESS'
  AND rl.created_at BETWEEN $from AND $to
GROUP BY u.name, rl.object_type
ORDER BY assignment_count DESC
```

**Failed routings:**
```sql
SELECT * FROM routing_logs
WHERE org_id = $orgId
  AND status IN ('FAILED')
ORDER BY created_at DESC
```

---

## Key Files

| File | Purpose |
|---|---|
| `apps/web/app/(dashboard)/history/page.tsx` | Routing history page |
| `apps/web/app/(dashboard)/history/stats/page.tsx` | Per-rep assignment stats |
| `apps/web/app/(dashboard)/history/failed/page.tsx` | Failed routings panel |
| `apps/web/app/(dashboard)/history/audit/page.tsx` | Config audit log |
| `apps/web/app/api/routing-logs/route.ts` | Paginated history list |
| `apps/web/app/api/routing-logs/export/route.ts` | CSV stream |
| `apps/web/app/api/routing-logs/stats/route.ts` | Per-rep counts |
| `apps/web/app/api/routing-logs/[id]/retry/route.ts` | Re-enqueue to BullMQ |
| `apps/web/app/api/audit-logs/route.ts` | Config audit log |

---

## Verification Checklist
- [ ] Routing history table shows events from Phase 5 engine with correct columns
- [ ] Date range filter correctly limits results
- [ ] Status filter shows only FAILED events when selected
- [ ] Clicking a Record ID opens the record in Salesforce (new tab)
- [ ] CSV export downloads correctly with all columns; UTF-8 for Indian names
- [ ] Per-rep stats show correct counts matching routing log entries
- [ ] Failed panel shows DLQ entries; Retry re-enqueues and updates status
- [ ] Config audit log shows licensing and rule changes from Phases 2–4
- [ ] Audit log row expansion shows before/after diff
