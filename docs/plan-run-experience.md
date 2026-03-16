# Plan: Run Route Experience — List Page + Detail Page

## Context

Users need to manually run scheduled routes and see progress. Two surfaces:
1. **Route list page** — inline progress bar in card when running
2. **Route detail/flow page** — "Run Route" top bar button opens slide-out panel with phased progress

Reference prototypes: `run-list-prototype.html`, `run-detail-prototype.html`

---

## Agent 1: Route List Page — Inline Run Progress

### File: `apps/web/app/(dashboard)/routing-rules/page.tsx`

**Current state**: Has `runMutation` that POSTs to `/api/rules/${id}/run` and shows toast. No progress indication.

**Changes needed**:

1. Add `runningRuleId` state to track which rule is currently running
2. Add `runProgress` state: `{ phase: string, pct: number, recordsRouted: number, total: number } | null`
3. When Play is clicked:
   - Set `runningRuleId` to the rule ID
   - Show inline progress bar inside that rule's card (below the info row)
   - Animate through phases: "Querying Salesforce..." → "Routing records..." → "Completing..."
   - On completion: green flash on card, toast with results, update stats via invalidation
4. Progress bar component (inline in the card):
   - Thin bar (h-1.5, rounded-full, teal gradient fill)
   - Text: phase label + percentage
   - Fades out after completion
5. During run:
   - Play button becomes a Loader spinner
   - Subtitle changes to "Running now..."
   - Stats show animated counter (optional — can just update on completion)
6. After completion:
   - Brief green ring/border on the card (2s, then fades)
   - Toast: "✓ {name} completed — {n} records routed in {duration}"
   - Stats update via query invalidation

**Note**: Since the actual API is a stub (returns instantly with 0 records), simulate progress client-side for now with a setTimeout sequence. When the real API supports streaming/SSE, this can be upgraded.

### Unit test: `apps/web/app/(dashboard)/routing-rules/page.test.tsx`
- Test that clicking Play sets running state and shows progress bar
- Test that completion updates stats and shows toast

---

## Agent 2: Route Detail Page — Run Route Button + Slide-out Panel

### File: `apps/web/components/route-builder/RouteBuilder.tsx`

**Changes needed**:

1. Add `Play` icon import from lucide-react
2. Add `isRunning`, `runProgress`, `showRunPanel` state
3. Add "Run Route" button to the top bar (next to Save Route), only shown for scheduled routes (`state.routeType === "SCHEDULED"`)
4. Clicking "Run Route" opens a slide-out panel from right AND immediately starts the run
5. The panel shows:
   - Header: "Run Workflow" with close button
   - Progress bar (teal gradient, 0-100%)
   - 4 workflow steps with status indicators:
     - Query Salesforce (pending → active → done)
     - Match & Deduplicate (pending → active → done)
     - Filter & Route (pending → active → done)
     - Assign Owners (pending → active → done)
   - Elapsed timer
   - On completion: green summary box with stats
   - "Run Again" button appears after completion
   - Run History section (fetched from API or mocked)

6. During run, canvas nodes should glow:
   - Current step's node gets `ring-2 ring-teal-300 shadow-teal-100` class
   - Completed nodes get `ring-2 ring-green-200` class
   - This requires passing a `runningNodeType` state to the node renderer

### New component: `apps/web/components/route-builder/RunPanel.tsx`
Extract the run panel into its own component for cleanliness:
```typescript
interface RunPanelProps {
  ruleId: string
  routeName: string
  isOpen: boolean
  onClose: () => void
  onRunStart: () => void
  onRunComplete: () => void
}
```

### File: `apps/web/app/(dashboard)/routing-rules/[id]/flow/page.tsx`
- Pass `routeType` from rule data to RouteBuilder (already available from `ruleQuery.data.rule`)

### Unit test: `apps/web/components/route-builder/RunPanel.test.tsx`
- Test panel opens when Run Route clicked
- Test phases progress correctly
- Test summary shows on completion

---

## Agent 3: API + Backend — Real Run Endpoint

### File: `apps/web/app/api/rules/[id]/run/route.ts`

**Current state**: Stub that increments `totalRuns` and returns 0 records.

**Changes needed**:

1. Look up the rule's `searchCriteria` (JSON field) and `objectType`
2. Look up the org's Salesforce connection (access token, instance URL) from the organization record
3. Build SOQL query from `searchCriteria`:
   - Parse the condition groups (same format as trigger conditions)
   - Generate `SELECT Id, OwnerId, ... FROM {objectType} WHERE {conditions}`
4. Query Salesforce using jsforce (via `@lead-routing/sfdc` package)
5. For each matching record, POST to the engine's `/route` endpoint (or enqueue via BullMQ)
6. Update `lastRunAt`, `lastRunStatus`, `lastRunRecords`, `lastRunDurationMs`, `totalRuns`, `totalRecordsRouted`
7. Create audit log entry
8. Return `{ success, recordsFound, recordsRouted, durationMs }`

**Important**: The jsforce/sfdc package can only be used server-side. Import from `@lead-routing/sfdc`.

### Supporting: `apps/web/lib/build-soql.ts` (NEW)
Helper to convert searchCriteria JSON into a SOQL WHERE clause:
```typescript
export function buildSoqlFromCriteria(
  objectType: string,
  criteria: Array<{ field: string; operator: string; value: string }>
): string
```

### Unit test: `apps/web/lib/build-soql.test.ts`
- Test various operators (equals, not equals, contains, greater than, etc.)
- Test empty criteria returns all records
- Test SOQL injection prevention

---

## Agent 4: Tests + Documentation Updates

### Tests to create/update:
1. `apps/web/app/(dashboard)/routing-rules/page.test.tsx` — list page run interaction
2. `apps/web/components/route-builder/RunPanel.test.tsx` — run panel
3. `apps/web/lib/build-soql.test.ts` — SOQL builder

### Documentation to update:
1. `Architecture.md` — Add section on Run Route experience (API endpoint, SOQL builder, progress UI)
2. `Technical-Implementation.md` — Add run endpoint to API routes table

---

## Verification

1. Route list page: clicking Play on a scheduled route shows inline progress bar, completion toast, updated stats
2. Route detail page: "Run Route" button appears for scheduled routes, opens panel, runs workflow with phased progress
3. API endpoint builds SOQL from search criteria and queries Salesforce
4. Canvas nodes glow during run phases
5. Run panel shows summary on completion with "Run Again" button
6. Tests pass
