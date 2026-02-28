export interface EvalCondition {
  groupId: string;
  fieldName: string;
  operator: string;
  value: string | null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function evalCondition(record: Record<string, unknown>, c: EvalCondition): boolean {
  // SFDC sends field names in lowercase; conditions store them in Pascal case.
  // Build a lowercase key map once per lookup.
  const lowerKey = c.fieldName.toLowerCase();
  const raw = record[c.fieldName] ?? record[lowerKey] ?? null;
  const { operator, value } = c;

  switch (operator) {
    case "is_blank":     return isBlank(raw);
    case "is_not_blank": return !isBlank(raw);
    case "is_true":      return raw === true || raw === "true" || raw === "True";
    case "is_false":     return raw === false || raw === "false" || raw === "False" || isBlank(raw);
    case "equals":       return String(raw ?? "") === String(value ?? "");
    case "not_equals":   return String(raw ?? "") !== String(value ?? "");
    case "contains":     return String(raw ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
    case "not_contains": return !String(raw ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
    case "starts_with":  return String(raw ?? "").toLowerCase().startsWith(String(value ?? "").toLowerCase());
    case "gt":           return Number(raw) > Number(value);
    case "lt":           return Number(raw) < Number(value);
    case "gte":          return Number(raw) >= Number(value);
    case "lte":          return Number(raw) <= Number(value);
    case "before":       return new Date(String(raw)) < new Date(String(value));
    case "after":        return new Date(String(raw)) > new Date(String(value));
    case "within_last": {
      const days = Number(value);
      const cutoff = new Date(Date.now() - days * 86_400_000);
      return new Date(String(raw)) >= cutoff;
    }
    case "includes": {
      const rawVals = String(raw ?? "").split(";").map((s) => s.trim()).filter(Boolean);
      const checkVals = String(value ?? "").split(";").map((s) => s.trim()).filter(Boolean);
      return checkVals.length > 0 && checkVals.every((v) => rawVals.includes(v));
    }
    case "excludes": {
      const rawVals = String(raw ?? "").split(";").map((s) => s.trim()).filter(Boolean);
      const checkVals = String(value ?? "").split(";").map((s) => s.trim()).filter(Boolean);
      return !checkVals.some((v) => rawVals.includes(v));
    }
    default:
      return false;
  }
}

/**
 * Evaluate a rule's conditions against a record.
 * - Zero conditions → catch-all, always true
 * - Within a group: AND (all must pass)
 * - Between groups: OR (any group passing = match)
 */
export function evaluateRule(
  record: Record<string, unknown>,
  conditions: EvalCondition[]
): boolean {
  if (conditions.length === 0) return true;

  const groupMap = new Map<string, EvalCondition[]>();
  for (const c of conditions) {
    if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, []);
    groupMap.get(c.groupId)!.push(c);
  }

  for (const groupConds of groupMap.values()) {
    if (groupConds.every((c) => evalCondition(record, c))) return true;
  }
  return false;
}
