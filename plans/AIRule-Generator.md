# Phase 9 — AI-Assisted Routing Rule Creation

## Context

Creating routing rules is the highest-friction part of the product. RevOps users must:
- Browse 45+ SFDC field names by API name
- Understand AND/OR condition group logic
- Hand-craft raw JSON to test rules
- Read each condition row to understand what an existing rule does

This phase adds three focused AI features (Claude API) that eliminate the most painful steps, in implementation order from lowest to highest effort.

---

## Feature Overview

| # | Feature | Entry Point | Model Call | Streaming? |
|---|---------|------------|------------|-----------|
| 1 | **Inline Rule Explainer** | Always-on card below conditions in form | `POST /api/ai/explain-rule` | ✅ SSE |
| 2 | **AI Test Record Generator** | 3 buttons in Test Rule panel | `POST /api/ai/generate-test-record` | ❌ batch |
| 3 | **Natural Language → Rule** | "Create with AI" choice on `/routing-rules/new` | `POST /api/ai/generate-rule` | ❌ batch |

---

## Implementation Plan

### Step 1 — Infrastructure

**Install SDK in `apps/web`:**
```
pnpm add @anthropic-ai/sdk
```

**Add to `apps/web/.env.local`:**
```
ANTHROPIC_API_KEY=sk-ant-...
```

**Create `apps/web/lib/ai.ts`** — lazy singleton:
```ts
import Anthropic from "@anthropic-ai/sdk";
let _client: Anthropic | null = null;
export function getAnthropicClient() {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return _client;
}
export const AI_MODEL = "claude-sonnet-4-6";
```

**Create `apps/web/lib/ai-types.ts`** — shared TypeScript interfaces:
- `AiFieldSchema { apiName, label, type, options? }`
- `GeneratedCondition { fieldApiName, operator, value }`
- `GeneratedConditionGroup { conjunction, conditions }`
- `GenerateRuleResponse { name, triggerEvent, assignmentType, isDryRun, conditionGroups, explanation }`
- `ExplainRuleRequest/Response`
- `GenerateTestRecordRequest/Response` (with `variant: "matching" | "edge" | "non_matching"`)

**Create `apps/web/lib/ai-helpers.ts`** — token optimisation:
```ts
export function slimField(f: FieldSchema): AiFieldSchema {
  return {
    apiName: f.fieldApiName,
    label: f.fieldLabel,
    type: f.fieldType,
    options: (f.fieldType === "PICKLIST" || f.fieldType === "MULTI_PICKLIST")
      && Array.isArray(f.picklistValues) && f.picklistValues.length <= 30
        ? f.picklistValues as string[]
        : undefined,
  };
}
```

---

### Step 2 — Feature 1: Inline Rule Explainer

**New file:** `apps/web/app/api/ai/explain-rule/route.ts`

- Auth: `await getOrgIdFromHeaders()`
- Fast path: if `conditionGroups.length === 0` → return static JSON (no LLM call): `"This is a catch-all rule that matches every ${objectType} on ${triggerEvent}"`
- Otherwise: SSE stream via `client.messages.stream()`
- System prompt: explain the rule in 1-2 plain-English sentences, return only the sentence, no JSON
- Token budget: ~200 tokens input (no field schemas needed — field API names are descriptive enough)

**New file:** `apps/web/components/ai/RuleExplainer.tsx` (client component)

- Props: `{ objectType, triggerEvent, assignmentType, conditions: RuleConditions }`
- Debounce 800ms on `conditions` change, abort previous SSE stream via `AbortController`
- Renders violet callout card: `<Sparkles>` icon + "AI Summary" label + streaming text
- Hides entirely until first content arrives (no flickering empty card)
- Convert `RuleConditions` → `GeneratedConditionGroup[]` before POST (client-side transformation)

**Modify `apps/web/components/rule-form/RuleForm.tsx`:**
- Import and render `<RuleExplainer>` directly after the conditions section card
- Pass live form state: `objectType`, `triggerEvent`, `assignmentType`, `conditions`

---

### Step 3 — Feature 2: AI Test Record Generator

**New file:** `apps/web/app/api/ai/generate-test-record/route.ts`

- Auth: `await getOrgIdFromHeaders()`
- Body: `{ conditions: flat RuleCondition[], variant }`
- Fetches field schemas from DB for only the conditioned field names (not full schema): `prisma.fieldSchema.findMany({ where: { orgId, fieldApiName: { in: fieldNames } } })`
- System prompt: generate a realistic SFDC record where all conditions pass/fail per variant. Include 3-5 extra realistic fields. Return `{ record: {...}, rationale: "..." }`
- Returns batch JSON (not streaming)

**Modify `apps/web/components/rule-form/RuleForm.tsx` (or extract `TestRulePanel`):**

- Extend `TestRulePanel` props: add `conditions: RuleConditions`
- Add above the textarea:
  ```
  Generate: [Matching Record] [Edge Case] [Non-Matching Record]
  ```
  Buttons disabled when no conditions exist
- `generateTestRecord(variant)` async function: flatten `RuleConditions` → `POST /api/ai/generate-test-record`, on success write JSON to textarea state, show `rationale` as caption
- Individual loading state per button

---

### Step 4 — Feature 3: Natural Language → Rule

**New file:** `apps/web/app/api/ai/generate-rule/route.ts`

- Auth: `await getOrgIdFromHeaders()`
- Body: `{ prompt: string, objectType }`
- Fetches ALL field schemas for the org+objectType: `prisma.fieldSchema.findMany(...)`, runs through `slimFields()`
- System prompt (strict JSON schema output):
  - Defines required output shape: `{ name, triggerEvent, assignmentType, isDryRun, conditionGroups, explanation }`
  - Spells out valid operators per field type
  - "Return ONLY the JSON object. No markdown."
- Returns batch JSON; validates `name` and `conditionGroups` exist before returning
- Token budget: ~800 (system) + ~300 (slim fields) + ~100 (prompt) ≈ 1,200 input tokens

**Modify `apps/web/app/(dashboard)/routing-rules/new/page.tsx`:**

Add `mode: "choose" | "manual" | "ai"` state. Page flow:

1. **`mode = "choose"`**: Two-card grid — "Build manually" (Settings2 icon) and "Create with AI" (Sparkles icon)
2. **`mode = "ai"`**: Render `<AiRuleGenerator>` component
3. **`mode = "manual"`**: Render existing `<RuleForm>` with optional `defaultValues` set by AI

**New file:** `apps/web/components/ai/AiRuleGenerator.tsx`

Two internal steps: `"prompt"` and `"review"`.

`"prompt"` step:
- Large textarea: "Describe your routing rule in plain English..."
- Object type selector (LEAD/CONTACT/ACCOUNT) — pre-selected from URL param if available
- "Generate Rule" button → calls `POST /api/ai/generate-rule` → transitions to `"review"`

`"review"` step:
- Violet callout with `explanation` text
- Read-only condition summary: each group as a card with condition rows
- Two CTA buttons: **"Use This Rule →"** and **"Try Again"**
- "Use This Rule →" converts `GeneratedConditionGroup[]` to `RuleConditions` (add `nanoid()` IDs to groups and conditions), calls `onAccepted(generatedRule)`
- Parent sets `defaultValues` on `RuleForm` and switches `mode → "manual"` — user lands on fully-populated form

Client-side validation on accept: check each `fieldApiName` against the field list; check each operator against `getOperatorsForType(fieldType)` from `apps/web/lib/operators.ts`. Strip invalid conditions silently and show a warning banner if any were removed.

---

## Files Created / Modified

### New files
```
apps/web/lib/ai.ts
apps/web/lib/ai-types.ts
apps/web/lib/ai-helpers.ts
apps/web/app/api/ai/explain-rule/route.ts
apps/web/app/api/ai/generate-test-record/route.ts
apps/web/app/api/ai/generate-rule/route.ts
apps/web/components/ai/RuleExplainer.tsx
apps/web/components/ai/AiRuleGenerator.tsx
```

### Modified files
```
apps/web/components/rule-form/RuleForm.tsx        — add RuleExplainer, extend TestRulePanel
apps/web/app/(dashboard)/routing-rules/new/page.tsx — choice screen + AI mode
apps/web/.env.local                               — ANTHROPIC_API_KEY
```

### Reference files (read-only)
```
apps/web/lib/operators.ts                         — valid operators per fieldType
apps/web/components/condition-builder/types.ts    — RuleConditions shape
apps/web/lib/auth.ts                              — await getOrgIdFromHeaders()
apps/web/app/api/rules/route.ts                   — auth/error pattern to follow
```

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Claude returns non-JSON | 422 + "AI returned invalid content. Try again." toast |
| Claude uses unknown field | Client strips it, shows warning: "N conditions removed (unknown fields)" |
| Anthropic rate limit | 429 propagated, toast: "AI is busy, try in a moment" |
| No `ANTHROPIC_API_KEY` | 500, toast: "AI features not configured" |
| SSE stream drops mid-way | Partial summary shown (acceptable); next change triggers new stream |

---

## Streaming vs Batch Decisions

| Feature | Mode | Reason |
|---------|------|--------|
| Explain Rule | Streaming (SSE) | Always-on UI, streaming tokens appear in ~500ms, feels live |
| Generate Test Record | Batch | JSON inserted into textarea — partial JSON is invalid and confusing |
| Generate Rule | Batch | Must be complete JSON before review step can render |

---

## Verification / Testing

1. **Explainer**: Open any rule in edit mode, add a condition (e.g. `LeadSource equals Web`) → the violet AI Summary card should appear within ~1s and stream a sentence describing the rule.

2. **Test Record Generator**: Open any rule in edit mode. Click "Matching Record" → after ~2s the textarea should be populated with valid JSON. Click the "Evaluate" button → result should show `matched: true`.

3. **NL Generator**: Go to `/routing-rules/new`, click "Create with AI". Type: `"Route all web leads with annual revenue over $500k to the enterprise team"`. Click "Generate Rule" → review step should show conditions for `LeadSource`, `AnnualRevenue`. Click "Use This Rule" → form should be pre-populated. Change the assignee and click "Create Rule" → rule should be saved.
