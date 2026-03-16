# Record Journey — Detailed Routing Audit Trail

## Overview

The Record Journey feature provides complete visibility into **why** a record was routed a certain way. Users enter a Salesforce Record ID and see every routing decision: which rules were evaluated, which conditions matched/failed, what actual field values were compared, and how assignment was resolved.

**Wireframe**: See `record-journey-prototype.html` in repo root.

## Architecture

### Data Model

Single `decisionTrace Json?` column added to the existing `RoutingLog` model. The engine populates this with a structured JSON trace during routing. No separate model needed — trace data is always read alongside the log entry.

### Decision Trace Schema

```typescript
interface DecisionTrace {
  version: 1;
  trigger: { event: string; objectType: string; recordId: string; timestampMs: number };
  cooldown?: { checked: true; skipped: boolean };
  rulesEvaluated: Array<{
    ruleId: string;
    ruleName: string;
    priority: number;
    outcome: "MATCHED" | "UNMATCHED" | "SKIPPED_TRIGGER_EVENT";
    matchPhase?: {
      config: { checkLeads: boolean; checkContacts: boolean; checkAccounts: boolean; matchEmail: boolean; matchPhone: boolean; matchDomain: boolean; matchCompanyName: boolean; fuzzyMatchMode: string };
      checks: Array<{ objectType: string; matchField: string; found: boolean; matchedRecordId?: string; fuzzyScore?: number }>;
      result: { matched: boolean; matchedType?: string; action?: string };
    };
    branches?: Array<{
      branchId: string; label: string; priority: number; matched: boolean;
      conditionGroups: Array<{
        groupId: string; groupMatched: boolean;
        conditions: Array<{ fieldName: string; operator: string; expectedValue: string | null; actualValue: string | null; passed: boolean }>;
      }>;
    }>;
    legacyConditions?: Array<{ groupId: string; groupMatched: boolean; conditions: Array<{ fieldName: string; operator: string; expectedValue: string | null; actualValue: string | null; passed: boolean }> }>;
    defaultOwner?: { evaluated: boolean; resolved: boolean };
  }>;
  assignment?: {
    type: string; assigneeName: string; assigneeId: string;
    teamId?: string; teamName?: string;
    roundRobinDetail?: { teamMemberCount: number; selectedIndex: number };
    source: "MATCH_OWNER" | "MATCH_CUSTOM" | "BRANCH" | "DEFAULT_OWNER" | "LEGACY";
    branchLabel?: string;
  };
  timing: { totalMs: number; cooldownCheckMs?: number; matchPhaseMs?: number; evaluationMs?: number; assignmentMs?: number; sfdcUpdateMs?: number };
}
```

## APIs

### Single Record Journey — `GET /api/routing-logs/journey/[recordId]`

Returns all routing log entries for one Salesforce record, ordered by most recent first.

**Auth**: Session-based (x-org-id header from proxy.ts)

**Response**:
```json
{
  "recordId": "00QgL00000BUX3QUAX",
  "entries": [
    {
      "id": "clxyz...",
      "eventType": "INSERT",
      "status": "SUCCESS",
      "ruleName": "Financial Services",
      "pathLabel": "East Coast",
      "assigneeName": "John Smith",
      "assignmentType": "ROUND_ROBIN",
      "teamName": "East Coast Financial",
      "routingDurationMs": 234,
      "decisionTrace": { ... },
      "createdAt": "2026-03-13T23:34:22.000Z"
    }
  ]
}
```

### Batch Journey — `POST /api/routing-logs/journey/batch`

Pull journey data for multiple records at once. Designed for BI tools, data warehouses, and custom reporting.

**Request**:
```json
{
  "recordIds": ["00QgL00000BUX3QUAX", "00QgL00000BUX3NUAX"],
  "limit": 10,
  "since": "2026-03-01"
}
```

**Response**:
```json
{
  "records": {
    "00QgL00000BUX3QUAX": {
      "objectType": "LEAD",
      "totalEvents": 3,
      "entries": [ ... ]
    }
  },
  "meta": {
    "requestedIds": 2,
    "foundIds": 2,
    "missingIds": [],
    "truncated": false
  }
}
```

**Constraints**: Max 100 record IDs per request. Auth scoped to org.

## UI

"Record Journey" tab added to Activity page. Search by Record ID → vertical timeline of all routing events, each expandable to show:

1. **Trigger** — event type, object, timestamp
2. **Cooldown Check** — pass/blocked with TTL info
3. **Rule Evaluation** — all rules evaluated with condition tables (field, operator, expected, actual, pass/fail)
4. **Assignment** — type, team, round-robin position, owner change
5. **Timing Breakdown** — waterfall chart per phase

## Implementation Checklist

- [ ] Schema: Add `decisionTrace Json?` to RoutingLog + composite index
- [ ] Migration: `20260314000000_add_decision_trace`
- [ ] Engine: Add `evaluateRuleDetailed()` to evaluator.ts
- [ ] Engine: Instrument router.ts with DecisionTrace collection
- [ ] API: Single record journey endpoint
- [ ] API: Batch journey endpoint
- [ ] UI: Activity layout — add "Record Journey" tab
- [ ] UI: Journey page with search bar
- [ ] UI: JourneyTimeline component
- [ ] UI: JourneyStep component
- [ ] UI: ConditionTable component
- [ ] UI: AssignmentCard component
- [ ] UI: TimingBreakdown component
- [ ] Architecture.md: Add §19 Record Journey documentation
- [ ] Deploy: Build + deploy engine and web images to VPS
