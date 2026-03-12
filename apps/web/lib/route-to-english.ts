import type { Condition, ConditionGroup } from "@/components/condition-builder/types";
import type {
  RouteBuilderState,
  MatchConfig,
  RoutePath,
  DefaultOwner,
  ObjectType,
  TriggerEvent,
  AssignmentType,
} from "@/components/route-builder/types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EnglishSection {
  id: string;
  type: "trigger" | "match" | "path" | "default";
  title: string;
  lines: string[];
  status: "ok" | "warning" | "error";
  pathIndex?: number;
}

export interface RouteWarning {
  severity: "error" | "warning" | "info";
  message: string;
  relatedSection?: string;
}

export interface EnglishReview {
  sections: EnglishSection[];
  warnings: RouteWarning[];
}

// ---------------------------------------------------------------------------
// Operator labels (exported for token rendering in UI components)
// ---------------------------------------------------------------------------

export const OPERATOR_LABELS: Record<string, string> = {
  equals: "equals",
  not_equals: "does not equal",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  gt: "is greater than",
  lt: "is less than",
  gte: "is at least",
  lte: "is at most",
  is_blank: "is blank",
  is_not_blank: "is not blank",
  is_true: "is true",
  is_false: "is false",
  includes: "includes",
  excludes: "excludes",
  before: "is before",
  after: "is after",
  within_last: "is within the last",
  fuzzy_equals: "fuzzy matches",
  sounds_like: "sounds like",
  similar_to: "is similar to",
};

const NO_VALUE_OPERATORS = new Set([
  "is_blank",
  "is_not_blank",
  "is_true",
  "is_false",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function objectLabel(obj: ObjectType): string {
  switch (obj) {
    case "LEAD":
      return "Lead";
    case "CONTACT":
      return "Contact";
    case "ACCOUNT":
      return "Account";
  }
}

function objectLabelPlural(obj: ObjectType): string {
  return objectLabel(obj) + "s";
}

function eventLabel(event: TriggerEvent): string {
  switch (event) {
    case "INSERT":
      return "created";
    case "UPDATE":
      return "updated";
    case "BOTH":
      return "created or updated";
  }
}

function assignmentTypeLabel(type: AssignmentType): string {
  switch (type) {
    case "USER":
      return "user";
    case "ROUND_ROBIN":
      return "round robin";
    case "QUEUE":
      return "queue";
  }
}

/**
 * Convert a single condition to readable text.
 * Exported for use by UI components (token rendering).
 */
export function conditionToText(condition: Condition): string {
  const field = condition.fieldApiName;
  const opLabel = OPERATOR_LABELS[condition.operator] ?? condition.operator;

  if (NO_VALUE_OPERATORS.has(condition.operator)) {
    return `${field} ${opLabel}`;
  }

  return `${field} ${opLabel} "${condition.value}"`;
}

function conditionGroupToText(group: ConditionGroup): string {
  if (group.conditions.length === 0) return "";

  const parts = group.conditions.map(conditionToText);
  const joiner = group.conjunction === "AND" ? " and " : " or ";
  return parts.join(joiner);
}

function conditionsToText(groups: ConditionGroup[]): string {
  const nonEmpty = groups.filter((g) => g.conditions.length > 0);
  if (nonEmpty.length === 0) return "";

  if (nonEmpty.length === 1) {
    return conditionGroupToText(nonEmpty[0]);
  }

  // Multiple groups are joined with OR (groups represent OR-joined sets)
  const groupTexts = nonEmpty.map((g) => `(${conditionGroupToText(g)})`);
  return groupTexts.join(" or ");
}

function hasConditions(groups: ConditionGroup[]): boolean {
  return groups.some((g) => g.conditions.length > 0);
}

function serializeConditions(groups: ConditionGroup[]): string {
  const normalized = groups
    .filter((g) => g.conditions.length > 0)
    .map((g) => ({
      conjunction: g.conjunction,
      conditions: g.conditions
        .map((c) => `${c.fieldApiName}|${c.operator}|${c.value}`)
        .sort(),
    }))
    .sort((a, b) => a.conditions.join(",").localeCompare(b.conditions.join(",")));
  return JSON.stringify(normalized);
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildTriggerSection(state: RouteBuilderState): EnglishSection {
  const { objectType, triggerEvent, isDryRun, triggerConditions } = state.trigger;
  const obj = objectLabel(objectType);
  const evt = eventLabel(triggerEvent);
  const lines: string[] = [];

  if (hasConditions(triggerConditions)) {
    lines.push(
      `When a ${obj} is ${evt} where ${conditionsToText(triggerConditions)}`
    );
  } else {
    lines.push(
      `When a ${obj} is ${evt} \u2014 all ${objectLabelPlural(objectType)} will be processed`
    );
  }

  if (isDryRun) {
    lines.push("Dry run mode \u2014 leads will be logged but not assigned");
  }

  return {
    id: "trigger",
    type: "trigger",
    title: "TRIGGER",
    lines,
    status: "ok",
  };
}

function buildMatchSection(matchConfig: MatchConfig): EnglishSection {
  const lines: string[] = [];

  // Objects checked
  const objects: string[] = [];
  if (matchConfig.checkLeads) objects.push("Leads");
  if (matchConfig.checkContacts) objects.push("Contacts");
  if (matchConfig.checkAccounts) objects.push("Accounts");

  // Fields matched
  const fields: string[] = [];
  if (matchConfig.matchEmail) fields.push("email");
  if (matchConfig.matchPhone) fields.push("phone");
  if (matchConfig.matchDomain) fields.push("domain");
  if (matchConfig.matchCompanyName) fields.push("company name");

  if (objects.length > 0 && fields.length > 0) {
    lines.push(`Check for matching ${objects.join("/")} by ${fields.join(", ")}.`);
  }

  // Fuzzy mode
  if (matchConfig.fuzzyMatchMode !== "STRICT") {
    const modeLabel =
      matchConfig.fuzzyMatchMode === "FUZZY" ? "fuzzy" : "AI smart";
    lines.push(`Using ${modeLabel} matching`);
  }

  // Per-object actions
  if (matchConfig.checkLeads) {
    lines.push(`If a Lead match is found \u2192 ${matchActionLabel("Lead", matchConfig.onLeadMatch, matchConfig.leadCustomAssignment)}.`);
  }
  if (matchConfig.checkContacts) {
    lines.push(`If a Contact match is found \u2192 ${matchActionLabel("Contact", matchConfig.onContactMatch, matchConfig.contactCustomAssignment)}.`);
  }
  if (matchConfig.checkAccounts) {
    lines.push(`If an Account match is found \u2192 ${matchActionLabel("Account", matchConfig.onAccountMatch, matchConfig.accountCustomAssignment)}.`);
  }

  return {
    id: "match",
    type: "match",
    title: "MATCH",
    lines,
    status: "ok",
  };
}

function matchActionLabel(
  _objName: string,
  action: string,
  custom: { assignmentType: AssignmentType; assigneeName: string } | null
): string {
  switch (action) {
    case "SFDC_MERGE":
      return "merge records";
    case "ASSIGN_TO_OWNER":
      return "assign to existing owner";
    case "SKIP":
      return "skip";
    case "ASSIGN_CUSTOM":
      if (custom) {
        return `assign via ${assignmentTypeLabel(custom.assignmentType)} to ${custom.assigneeName || "(not set)"}`;
      }
      return "assign (not configured)";
    default:
      return action;
  }
}

function buildPathSection(
  path: RoutePath,
  index: number
): EnglishSection {
  const label = path.label || `Path ${index + 1}`;
  const title = `PATH ${index + 1} \u2014 ${label}`;
  const id = `path-${path.id}`;
  const lines: string[] = [];
  let status: EnglishSection["status"] = "ok";

  const isCatchAll = !hasConditions(path.conditions);
  const hasAssignment =
    path.action.assignmentType !== null && path.action.assigneeId !== null;

  if (!hasAssignment) {
    lines.push("Assignment not configured");
    status = "error";
  } else if (isCatchAll) {
    lines.push(
      `All remaining records \u2192 assign via ${assignmentTypeLabel(path.action.assignmentType!)} to ${path.action.assigneeName || "(not set)"}.`
    );
  } else {
    const condText = conditionsToText(path.conditions);
    lines.push(
      `If ${condText}, assign via ${assignmentTypeLabel(path.action.assignmentType!)} to ${path.action.assigneeName || "(not set)"}.`
    );
  }

  return { id, type: "path", title, lines, status, pathIndex: index };
}

function buildDefaultSection(defaultOwner: DefaultOwner): EnglishSection {
  return {
    id: "default",
    type: "default",
    title: "DEFAULT",
    lines: [
      `If no path matches, assign to ${defaultOwner.assigneeName || "(not set)"} (${assignmentTypeLabel(defaultOwner.assignmentType)}).`,
    ],
    status: "ok",
  };
}

// ---------------------------------------------------------------------------
// Warning detection
// ---------------------------------------------------------------------------

function detectWarnings(
  state: RouteBuilderState,
  sections: EnglishSection[]
): RouteWarning[] {
  const warnings: RouteWarning[] = [];

  // Unconfigured assignments
  for (let i = 0; i < state.paths.length; i++) {
    const p = state.paths[i];
    if (p.action.assignmentType === null || p.action.assigneeId === null) {
      warnings.push({
        severity: "error",
        message: `Path "${p.label || `Path ${i + 1}`}" has no assignment configured`,
        relatedSection: `path-${p.id}`,
      });
    }
  }

  // Unreachable paths: catch-all before conditional paths
  const catchAllIndices: number[] = [];
  const conditionalIndices: number[] = [];
  for (let i = 0; i < state.paths.length; i++) {
    if (hasConditions(state.paths[i].conditions)) {
      conditionalIndices.push(i);
    } else {
      catchAllIndices.push(i);
    }
  }

  for (const catchAllIdx of catchAllIndices) {
    for (const condIdx of conditionalIndices) {
      if (catchAllIdx < condIdx) {
        warnings.push({
          severity: "error",
          message: `Path "${state.paths[condIdx].label || `Path ${condIdx + 1}`}" is unreachable because a catch-all path appears before it`,
          relatedSection: `path-${state.paths[condIdx].id}`,
        });
      }
    }
  }

  // Multiple catch-alls
  if (catchAllIndices.length > 1) {
    warnings.push({
      severity: "warning",
      message: "Multiple catch-all paths detected \u2014 only the first will execute",
    });
  }

  // Overlapping conditions
  const seen = new Map<string, number>();
  for (let i = 0; i < state.paths.length; i++) {
    const p = state.paths[i];
    if (!hasConditions(p.conditions)) continue;
    const key = serializeConditions(p.conditions);
    if (seen.has(key)) {
      const prevIdx = seen.get(key)!;
      warnings.push({
        severity: "warning",
        message: `Path "${p.label || `Path ${i + 1}`}" has identical conditions to Path "${state.paths[prevIdx].label || `Path ${prevIdx + 1}`}"`,
        relatedSection: `path-${p.id}`,
      });
    } else {
      seen.set(key, i);
    }
  }

  // Missing default owner
  if (state.paths.length > 0 && state.defaultOwner === null) {
    warnings.push({
      severity: "warning",
      message: "No default owner configured \u2014 unmatched records will not be assigned",
    });
  }

  // No trigger criteria
  if (!hasConditions(state.trigger.triggerConditions)) {
    warnings.push({
      severity: "info",
      message: "No trigger criteria \u2014 all records will enter the routing flow",
      relatedSection: "trigger",
    });
  }

  // Dry run active
  if (state.trigger.isDryRun) {
    warnings.push({
      severity: "info",
      message: "Dry run is active \u2014 no records will actually be assigned",
      relatedSection: "trigger",
    });
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function routeToEnglish(state: RouteBuilderState): EnglishReview {
  const sections: EnglishSection[] = [];

  // Trigger section — always present
  sections.push(buildTriggerSection(state));

  // Match section — only if configured
  if (state.matchConfig) {
    sections.push(buildMatchSection(state.matchConfig));
  }

  // Path sections
  for (let i = 0; i < state.paths.length; i++) {
    sections.push(buildPathSection(state.paths[i], i));
  }

  // Default owner section
  if (state.defaultOwner) {
    sections.push(buildDefaultSection(state.defaultOwner));
  }

  const warnings = detectWarnings(state, sections);

  return { sections, warnings };
}
