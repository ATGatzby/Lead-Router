// Browser-safe copy of operator definitions.
// Client components must import from here, NOT from @lead-routing/sfdc
// (jsforce pulls in child_process which breaks the browser bundle).

export type Operator = { value: string; label: string };

const NUMERIC_OPS: Operator[] = [
  { value: "equals",     label: "=" },
  { value: "not_equals", label: "≠" },
  { value: "gt",         label: ">" },
  { value: "lt",         label: "<" },
  { value: "gte",        label: "≥" },
  { value: "lte",        label: "≤" },
  { value: "is_blank",   label: "is blank" },
];

const OPERATORS: Record<string, Operator[]> = {
  TEXT: [
    { value: "equals",       label: "equals" },
    { value: "not_equals",   label: "does not equal" },
    { value: "contains",     label: "contains" },
    { value: "not_contains", label: "does not contain" },
    { value: "starts_with",  label: "starts with" },
    { value: "includes",     label: "includes (multi-value)" },
    { value: "excludes",     label: "excludes (multi-value)" },
    { value: "gt",           label: ">" },
    { value: "lt",           label: "<" },
    { value: "gte",          label: "≥" },
    { value: "lte",          label: "≤" },
    { value: "is_blank",     label: "is blank" },
    { value: "is_not_blank", label: "is not blank" },
    { value: "fuzzy_equals", label: "fuzzy equals" },
    { value: "sounds_like",  label: "sounds like" },
    { value: "similar_to",   label: "is similar to (AI)" },
  ],
  NUMBER:   NUMERIC_OPS,
  CURRENCY: NUMERIC_OPS,
  DOUBLE:   NUMERIC_OPS,
  PERCENT:  NUMERIC_OPS,
  INT:      NUMERIC_OPS,
  PICKLIST: [
    { value: "equals",     label: "equals" },
    { value: "not_equals", label: "does not equal" },
    { value: "includes",   label: "includes" },
    { value: "excludes",   label: "excludes" },
  ],
  MULTI_PICKLIST: [
    { value: "includes", label: "includes" },
    { value: "excludes", label: "excludes" },
  ],
  BOOLEAN: [
    { value: "is_true",  label: "is true" },
    { value: "is_false", label: "is false" },
  ],
  DATE: [
    { value: "equals",      label: "is" },
    { value: "before",      label: "is before" },
    { value: "after",       label: "is after" },
    { value: "within_last", label: "is within last N days" },
    { value: "is_blank",    label: "is blank" },
  ],
  DATETIME: [
    { value: "equals",      label: "is" },
    { value: "before",      label: "is before" },
    { value: "after",       label: "is after" },
    { value: "within_last", label: "is within last N days" },
    { value: "is_blank",    label: "is blank" },
  ],
  LOOKUP: [
    { value: "equals",       label: "equals (ID)" },
    { value: "not_equals",   label: "does not equal (ID)" },
    { value: "is_blank",     label: "is blank" },
    { value: "is_not_blank", label: "is not blank" },
  ],
};

export function getOperatorsForType(fieldType: string): Operator[] {
  return OPERATORS[fieldType] ?? OPERATORS.TEXT;
}

export const NO_VALUE_OPERATORS = new Set([
  "is_blank",
  "is_not_blank",
  "is_true",
  "is_false",
]);
