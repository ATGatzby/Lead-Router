# Phase 4 — Routing Rules Builder

**Duration:** Week 3–5
**Status:** ⬜ Not Started
**Depends on:** Phase 1 (scaffold), Phase 2 (licensed users), Phase 3 (teams), Phase 2 SFDC field schema sync

---

## Goal
Build the no-code rule configuration interface where RevOps admins define exactly which SFDC records get routed and who receives them. This is the most complex UI in the product — it involves dynamic field loading, multi-condition logic groups, drag-to-reorder priority, and an assignment target selector.

---

## Deliverables
- [ ] Tabbed routing rules list (Lead / Contact / Account)
- [ ] Drag-to-reorder priority list
- [ ] New rule form with condition builder
- [ ] Condition builder: dynamic fields, operators per type, AND/OR groups
- [ ] Assignment target selector (User / Round Robin / Queue)
- [ ] Rule status toggle (Active/Inactive)
- [ ] Clone rule action
- [ ] Test Rule (dry-run evaluation against sample JSON)
- [ ] SFDC Queue sync
- [ ] Fallback/catch-all rule support (zero conditions)

---

## PRD Requirements Coverage

### Condition Builder
| ID | Requirement | Priority |
|---|---|---|
| RC-01 | List all available fields from SFDC schema sync | P0 |
| RC-02 | Support Text, Number, Date, DateTime, Boolean, Picklist, Multi-Picklist, Lookup | P0 |
| RC-03 | Operators per field type (full list per spec) | P0 |
| RC-04 | Multiple conditions with AND/OR logic + nested groups | P0 |
| RC-05 | Visual condition group builder — no code writing | P1 |
| RC-06 | Zero conditions allowed (catch-all rule) | P0 |
| RC-07 | Real-time validation of operator/field type combinations | P1 |
| RC-08 | Test Rule: paste sample JSON, see rule match results | P1 |

### Rule Management
| ID | Requirement | Priority |
|---|---|---|
| RO-01 | Rules scoped per object — no cross-object interference | P0 |
| RO-02 | Rules list with name, summary, assignee, status, last modified | P0 |
| RO-03 | Priority order (drag-to-reorder) | P0 |
| RO-04 | First-match-wins by default | P0 |
| RO-05 | Clone rule | P1 |
| RO-06 | Global fallback rule per object | P0 |
| RO-07 | Unmatched records report | P1 |

---

## API Endpoints

```
GET    /api/rules?object=LEAD           → list rules for object (ordered by priority)
POST   /api/rules                       → create new rule
GET    /api/rules/:id                   → get rule detail (with conditions)
PUT    /api/rules/:id                   → update rule
DELETE /api/rules/:id                   → delete rule
PATCH  /api/rules/:id/status            → toggle active/inactive
POST   /api/rules/:id/clone             → duplicate rule (appends "Copy of")
POST   /api/rules/reorder               → body: { ruleIds: string[] } (new priority order)
POST   /api/rules/:id/test              → body: { record: object } → dry-run evaluation
GET    /api/fields?object=LEAD          → fields from field_schemas table
POST   /api/fields/sync?object=LEAD     → trigger SFDC describeSObject sync
GET    /api/queues                      → synced SFDC queues
POST   /api/queues/sync                 → trigger SFDC queue sync
```

---

## Operators Per Field Type

```typescript
// packages/sfdc/src/operators.ts

export const OPERATORS: Record<string, { value: string; label: string }[]> = {
  TEXT: [
    { value: 'equals',       label: 'equals' },
    { value: 'not_equals',   label: 'does not equal' },
    { value: 'contains',     label: 'contains' },
    { value: 'not_contains', label: 'does not contain' },
    { value: 'starts_with',  label: 'starts with' },
    { value: 'is_blank',     label: 'is blank' },
    { value: 'is_not_blank', label: 'is not blank' },
  ],
  NUMBER: [
    { value: 'equals',       label: '=' },
    { value: 'not_equals',   label: '≠' },
    { value: 'gt',           label: '>' },
    { value: 'lt',           label: '<' },
    { value: 'gte',          label: '≥' },
    { value: 'lte',          label: '≤' },
    { value: 'is_blank',     label: 'is blank' },
  ],
  PICKLIST: [
    { value: 'equals',       label: 'equals' },
    { value: 'not_equals',   label: 'does not equal' },
    { value: 'includes',     label: 'includes' },
    { value: 'excludes',     label: 'excludes' },
  ],
  MULTI_PICKLIST: [
    { value: 'includes',     label: 'includes' },
    { value: 'excludes',     label: 'excludes' },
  ],
  BOOLEAN: [
    { value: 'is_true',      label: 'is true' },
    { value: 'is_false',     label: 'is false' },
  ],
  DATE: [
    { value: 'equals',       label: 'is' },
    { value: 'before',       label: 'is before' },
    { value: 'after',        label: 'is after' },
    { value: 'within_last',  label: 'is within last N days' },
    { value: 'is_blank',     label: 'is blank' },
  ],
  LOOKUP: [
    { value: 'equals',       label: 'equals (ID)' },
    { value: 'not_equals',   label: 'does not equal (ID)' },
    { value: 'is_blank',     label: 'is blank' },
    { value: 'is_not_blank', label: 'is not blank' },
  ],
}
```

---

## Condition Builder Component Architecture

```
ConditionBuilder/
├── index.tsx               ← Main export; manages condition group state
├── ConditionGroup.tsx      ← One group (AND/OR); renders multiple ConditionRow
├── ConditionRow.tsx        ← Single condition: [Field] [Operator] [Value]
├── FieldSelect.tsx         ← Searchable dropdown of fields from field_schemas
├── OperatorSelect.tsx      ← Operators filtered by selected field type
├── ValueInput.tsx          ← Dynamic input: text, number, date, picklist dropdown
└── GroupConnector.tsx      ← AND/OR toggle between groups
```

**State shape:**
```typescript
type ConditionGroup = {
  id: string
  conjunction: 'AND' | 'OR'  // logic WITHIN the group
  conditions: Condition[]
}

type Condition = {
  id: string
  fieldApiName: string
  fieldType: FieldType
  operator: string
  value: string
}

// Between groups, logic is always OR (standard behaviour)
// "(A AND B) OR (C AND D)"
type RuleConditions = {
  groups: ConditionGroup[]
}
```

**Rendered example:**
```
  ┌── Group 1 ──────────────────────────── [+ Add Condition] [✕] ──┐
  │  Lead Source  ▼   equals  ▼   Web ▼                           │
  │                   AND                                          │
  │  Annual Revenue ▼  ≥  ▼   [100000      ]                      │
  └────────────────────────────────────────────────────────────────┘
                        OR
  ┌── Group 2 ──────────────────────────── [+ Add Condition] [✕] ──┐
  │  Lead Source  ▼   equals  ▼   Referral ▼                      │
  └────────────────────────────────────────────────────────────────┘
  [+ Add Condition Group]
```

---

## Test Rule Feature

```
Test Rule
─────────────────────────────────────────────────────
Paste a sample Lead record (JSON) to see which rules
would match. No changes will be made to Salesforce.

  { "LeadSource": "Web", "AnnualRevenue": 150000,
    "Status": "New", "Industry": "Technology" }

  [Evaluate →]

  ─────────────────────────────────────────────────────
  Results:
  ✅ Rule matched: "Enterprise Inbound Leads — West"
     Assignee: West Coast SDRs (Round Robin)
     Priority: 1

  ⏭ Rule skipped: "SMB Leads — All"
     Reason: Condition failed — AnnualRevenue < 50000
```

**Implementation:**
- Calls `POST /api/rules/:id/test` with the JSON payload
- Backend runs the same condition evaluation logic as the engine (shared `evaluator.ts`)
- Returns which rule(s) matched, which were skipped, and why

---

## Rules List UI

```
Routing Rules           Lead  |  Contact  |  Account

                                              [+ New Rule]
─────────────────────────────────────────────────────────
Priority  Rule Name               Conditions  Assignee        Status
──────────────────────────────────────────────────────────
  ⠿  1   Enterprise Inbound      2 conditions West Coast SDRs  ● Active
  ⠿  2   SMB Web Leads           1 condition  SDR Team A        ● Active
  ⠿  3   Referral Leads          3 conditions Priya Sharma      ● Active
  ⠿  4   Catch-all (fallback)    No conditions Inbound Queue    ● Active

         ⠿ = drag handle
```

---

## SFDC Field Schema Sync

```typescript
// packages/sfdc/src/schema.ts
export async function syncFieldSchema(
  conn: Connection,
  orgId: string,
  objectType: 'Lead' | 'Contact' | 'Account'
) {
  const describe = await conn.describe(objectType)

  const fields = describe.fields
    .filter(f => f.createable || f.updateable)  // only editable fields
    .map(f => ({
      orgId,
      objectType: objectType.toUpperCase(),
      fieldApiName: f.name,
      fieldLabel: f.label,
      fieldType: mapSfdcType(f.type),  // map to our FieldType enum
      picklistValues: f.picklistValues?.length
        ? f.picklistValues.map(v => v.value)
        : null,
    }))

  await prisma.fieldSchema.deleteMany({ where: { orgId, objectType } })
  await prisma.fieldSchema.createMany({ data: fields })
}
```

---

## Key Files

| File | Purpose |
|---|---|
| `apps/web/app/(dashboard)/routing-rules/page.tsx` | Tabbed rules list |
| `apps/web/app/(dashboard)/routing-rules/new/page.tsx` | New rule form |
| `apps/web/app/(dashboard)/routing-rules/[id]/edit/page.tsx` | Edit rule |
| `apps/web/components/condition-builder/index.tsx` | Condition builder root |
| `apps/web/components/condition-builder/ConditionRow.tsx` | Single condition row |
| `apps/web/components/condition-builder/ValueInput.tsx` | Dynamic value input |
| `apps/web/app/api/rules/route.ts` | Rules CRUD |
| `apps/web/app/api/rules/[id]/test/route.ts` | Test Rule endpoint |
| `apps/web/app/api/fields/route.ts` | Field schema list |
| `packages/sfdc/src/schema.ts` | SFDC describe + field sync |
| `packages/sfdc/src/operators.ts` | Operators per field type |

---

## Verification Checklist
- [ ] Lead fields load dynamically from `field_schemas` in condition builder
- [ ] Selecting "Picklist" field shows picklist values in value dropdown
- [ ] AND/OR group logic builder renders correctly and saves properly
- [ ] Drag-to-reorder updates priority in DB correctly
- [ ] Zero-condition (catch-all) rule saves without error
- [ ] Clone rule creates a copy with priority appended at end
- [ ] Test Rule with matching JSON shows correct rule match
- [ ] Test Rule with non-matching JSON shows which condition failed
- [ ] SFDC Queue list loads after sync
- [ ] Inactive rule is visually distinct and skipped in Test Rule evaluation
