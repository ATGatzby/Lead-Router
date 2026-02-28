/**
 * Condition evaluation engine — shared between the test endpoint and (eventually) the routing engine.
 *
 * Group logic: conditions within a group are AND-ed; groups are OR-ed.
 *   "(A AND B) OR (C AND D)"
 */

export interface EvalCondition {
  groupId: string;
  fieldName: string;
  operator: string;
  value: string | null;
}

export interface ConditionResult {
  fieldName: string;
  operator: string;
  value: string | null;
  passed: boolean;
  reason?: string;
}

export interface GroupResult {
  groupId: string;
  passed: boolean;
  conditions: ConditionResult[];
}

export interface EvalResult {
  matched: boolean;
  groups: GroupResult[];
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function evaluateCondition(
  record: Record<string, unknown>,
  cond: EvalCondition
): ConditionResult {
  const raw = record[cond.fieldName] ?? null;
  const { operator, value } = cond;

  let passed = false;
  let reason: string | undefined;

  try {
    switch (operator) {
      case "is_blank":
        passed = isBlank(raw);
        break;
      case "is_not_blank":
        passed = !isBlank(raw);
        break;
      case "is_true":
        passed = raw === true || raw === "true" || raw === "True";
        break;
      case "is_false":
        passed = raw === false || raw === "false" || raw === "False" || isBlank(raw);
        break;
      case "equals":
        passed = String(raw ?? "") === String(value ?? "");
        break;
      case "not_equals":
        passed = String(raw ?? "") !== String(value ?? "");
        break;
      case "contains":
        passed = String(raw ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
        break;
      case "not_contains":
        passed = !String(raw ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
        break;
      case "starts_with":
        passed = String(raw ?? "").toLowerCase().startsWith(String(value ?? "").toLowerCase());
        break;
      case "gt":
        passed = Number(raw) > Number(value);
        break;
      case "lt":
        passed = Number(raw) < Number(value);
        break;
      case "gte":
        passed = Number(raw) >= Number(value);
        break;
      case "lte":
        passed = Number(raw) <= Number(value);
        break;
      case "before":
        passed = new Date(String(raw)) < new Date(String(value));
        break;
      case "after":
        passed = new Date(String(raw)) > new Date(String(value));
        break;
      case "within_last": {
        const days = Number(value);
        const date = new Date(String(raw));
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        passed = date >= cutoff;
        break;
      }
      case "includes": {
        // Multi-picklist: raw value is semicolon-separated
        const rawVals = String(raw ?? "").split(";").map((s) => s.trim()).filter(Boolean);
        const checkVals = String(value ?? "").split(";").map((s) => s.trim()).filter(Boolean);
        passed = checkVals.length > 0 && checkVals.every((v) => rawVals.includes(v));
        break;
      }
      case "excludes": {
        const rawVals = String(raw ?? "").split(";").map((s) => s.trim()).filter(Boolean);
        const checkVals = String(value ?? "").split(";").map((s) => s.trim()).filter(Boolean);
        passed = !checkVals.some((v) => rawVals.includes(v));
        break;
      }
      default:
        reason = `Unknown operator: ${operator}`;
        passed = false;
    }
  } catch (e) {
    reason = `Evaluation error: ${String(e)}`;
    passed = false;
  }

  if (!passed && !reason) {
    reason = `${cond.fieldName} (${operator}) — expected: ${JSON.stringify(value)}, got: ${JSON.stringify(raw)}`;
  }

  return { fieldName: cond.fieldName, operator, value: cond.value, passed, reason };
}

/**
 * Evaluate a rule's conditions against a sample record.
 * Evaluates ALL groups to provide full diagnostic info.
 * Returns matched=true if any group is fully satisfied (OR between groups).
 */
export function evaluateRule(
  record: Record<string, unknown>,
  conditions: EvalCondition[]
): EvalResult {
  // Zero conditions = catch-all: always matches
  if (conditions.length === 0) {
    return { matched: true, groups: [] };
  }

  // Group conditions by groupId (preserving insertion order)
  const groupMap = new Map<string, EvalCondition[]>();
  for (const cond of conditions) {
    if (!groupMap.has(cond.groupId)) groupMap.set(cond.groupId, []);
    groupMap.get(cond.groupId)!.push(cond);
  }

  const groupResults: GroupResult[] = [];

  for (const [groupId, groupConds] of groupMap) {
    const condResults = groupConds.map((c) => evaluateCondition(record, c));
    const groupPassed = condResults.every((r) => r.passed);
    groupResults.push({ groupId, passed: groupPassed, conditions: condResults });
  }

  const matched = groupResults.some((g) => g.passed);
  return { matched, groups: groupResults };
}
