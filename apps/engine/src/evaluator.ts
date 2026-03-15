import { similarity, soundex, doubleMetaphone, fuzzyCompanyMatch } from './lib/fuzzy.js'
import { resolveCompanySimilarity } from './lib/ai-client.js'
import { checkAliasCache, cacheAliasResult } from './lib/alias-cache.js'

export interface EvalCondition {
  groupId: string;
  fieldName: string;
  operator: string;
  value: string | null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

async function evalCondition(record: Record<string, unknown>, c: EvalCondition, orgId: string): Promise<boolean> {
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

    // ─── Fuzzy operators (Phase 3) ────────────────────────────────────────
    case "fuzzy_equals": {
      const fieldValue = String(raw ?? "").toLowerCase().trim();
      const condValue = String(value ?? "").toLowerCase().trim();
      return similarity(fieldValue, condValue) >= 0.8;
    }
    case "sounds_like": {
      const fieldValue = String(raw ?? "");
      const condValue = String(value ?? "");
      const sxA = soundex(fieldValue);
      const sxB = soundex(condValue);
      if (sxA !== "0000" && sxA === sxB) return true;
      const [primaryA] = doubleMetaphone(fieldValue);
      const [primaryB] = doubleMetaphone(condValue);
      return primaryA !== "" && primaryA === primaryB;
    }
    case "similar_to": {
      const fieldValue = String(raw ?? "");
      const condValue = String(value ?? "");

      // Tier 1: Fuzzy company match (exact, abbreviation, soundex, levenshtein)
      const result = fuzzyCompanyMatch(fieldValue, condValue);
      if (result.match) return true;

      // Tier 2: Check alias cache
      const cached = await checkAliasCache(orgId, fieldValue, condValue);
      if (cached !== null) return cached;

      // Tier 3: Try AI (returns null if not configured)
      const aiResult = await resolveCompanySimilarity(orgId, fieldValue, condValue);
      if (aiResult) {
        await cacheAliasResult(orgId, fieldValue, condValue, aiResult.isSimilar, aiResult.confidence);
        return aiResult.isSimilar;
      }

      // Fallback: lower threshold
      return similarity(fieldValue.toLowerCase(), condValue.toLowerCase()) >= 0.7;
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
export async function evaluateRule(
  record: Record<string, unknown>,
  conditions: EvalCondition[],
  orgId: string = ""
): Promise<boolean> {
  if (conditions.length === 0) return true;

  const groupMap = new Map<string, EvalCondition[]>();
  for (const c of conditions) {
    if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, []);
    groupMap.get(c.groupId)!.push(c);
  }

  for (const groupConds of groupMap.values()) {
    const results = await Promise.all(groupConds.map((c) => evalCondition(record, c, orgId)));
    if (results.every(Boolean)) return true;
  }
  return false;
}

// ─── Detailed evaluation (for Record Journey trace) ──────────────────────

export interface DetailedCondition {
  fieldName: string;
  operator: string;
  expectedValue: string | null;
  actualValue: string | null;
  passed: boolean;
}

export interface DetailedConditionGroup {
  groupId: string;
  groupMatched: boolean;
  conditions: DetailedCondition[];
}

export interface DetailedEvalResult {
  matched: boolean;
  groups: DetailedConditionGroup[];
}

/**
 * Same logic as evaluateRule() but returns per-condition pass/fail with actual values.
 * Used by the router to build DecisionTrace for Record Journey.
 */
export async function evaluateRuleDetailed(
  record: Record<string, unknown>,
  conditions: EvalCondition[],
  orgId: string = ""
): Promise<DetailedEvalResult> {
  if (conditions.length === 0) return { matched: true, groups: [] };

  const groupMap = new Map<string, EvalCondition[]>();
  for (const c of conditions) {
    if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, []);
    groupMap.get(c.groupId)!.push(c);
  }

  let matched = false;
  const groups: DetailedConditionGroup[] = [];

  for (const [groupId, groupConds] of groupMap.entries()) {
    const results = await Promise.all(groupConds.map((c) => evalCondition(record, c, orgId)));
    const groupMatched = results.every(Boolean);
    if (groupMatched) matched = true;

    groups.push({
      groupId,
      groupMatched,
      conditions: groupConds.map((c, i) => {
        const lowerKey = c.fieldName.toLowerCase();
        const raw = record[c.fieldName] ?? record[lowerKey] ?? null;
        return {
          fieldName: c.fieldName,
          operator: c.operator,
          expectedValue: c.value != null ? String(c.value).substring(0, 200) : null,
          actualValue: raw != null ? String(raw).substring(0, 200) : null,
          passed: results[i],
        };
      }),
    });
  }

  return { matched, groups };
}
