import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const updateRuleTool = {
  name: "update_rule",
  description: `Update an existing routing rule. First call without confirm to see before/after diff, then call with confirm: true to execute.

IMPORTANT: When updating branches or conditions, you REPLACE the entire array — there is no merge/patch.
Always call get_rule first to see the current state, then send the complete updated branches array.

triggerEvent determines how the rule fires:
- "SEARCH" = Search-based rule (queries CRM for matching records). Sets routeType=SCHEDULED automatically.
- "INSERT" / "UPDATE" / "BOTH" = Real-time trigger (fires on CRM events). Sets routeType=REALTIME.

OPERATORS: equals, not_equals, contains, not_contains, starts_with, gt, lt, gte, lte, before, after, within_last, includes (semicolon-separated multi-value), excludes, is_blank, is_not_blank, is_true, is_false, fuzzy_equals, sounds_like

CONDITION LOGIC: conditions with the SAME groupId are AND'd together, different groupIds are OR'd.

ASSIGNMENT TYPES: USER (assigneeUserId), ROUND_ROBIN (assigneeTeamId), QUEUE (assigneeQueueId)

NESTED ROUTING (CRITICAL — read carefully):
When the user asks for multi-level routing (e.g. "split by region, then by size, then by industry"),
you MUST use the "steps" array with nested "split" steps. DO NOT flatten into separate branches —
that loses the hierarchical decision tree and field updates at each level.

WRONG (flat branches — loses nesting):
  branches: [
    { label: "US/Enterprise/Tech", conditions: [...3 conditions...], assignmentType: "USER" },
    { label: "US/SMB", conditions: [...2 conditions...], assignmentType: "ROUND_ROBIN" }
  ]

RIGHT (nested steps with splits — preserves hierarchy):
  branches: [{
    label: "US", steps: [
      { type: "filter", conditions: [{fieldApiName: "country", operator: "equals", value: "US"}] },
      { type: "updateField", fieldUpdates: [{fieldApiName: "region", fieldValue: "Americas"}] },
      { type: "split", paths: [
        { label: "Enterprise", steps: [
          { type: "filter", conditions: [{fieldApiName: "employees", operator: "gte", value: "500"}] },
          { type: "split", paths: [
            { label: "Tech", steps: [...filter + assign...] },
            { label: "Other", steps: [...assign...] }
          ]}
        ]},
        { label: "SMB", steps: [...filter + assign...] }
      ]}
    ]
  }]

Step types:
- "filter" — conditions to match: { "type": "filter", "conditions": [{ "fieldApiName": "field", "operator": "op", "value": "val" }] }
- "updateField" — update CRM fields: { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "field", "fieldValue": "value" }] }
- "assign" — assign to user/team: { "type": "assign", "assignmentType": "USER"|"ROUND_ROBIN", "assigneeId": "id" or "teamId": "id" }
- "split" — nested decision split: { "type": "split", "paths": [{ "label": "...", "steps": [...] }, ...], "defaultOwner": { "assignmentType": "...", "assigneeId": "..." } }

When using steps on a branch, ALSO set the branch-level conditions and assignmentType as fallback.

EXAMPLE — Adding a nested split to an existing rule:
{
  "ruleId": "rule-123",
  "branches": [{
    "label": "Enterprise", "priority": 0, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-ent",
    "conditions": [{ "groupId": "g1", "fieldName": "numberofemployees", "fieldType": "NUMBER", "operator": "gte", "value": "500" }],
    "steps": [
      { "type": "filter", "conditions": [{ "fieldApiName": "numberofemployees", "operator": "gte", "value": "500" }] },
      { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "company_tier", "fieldValue": "Enterprise" }] },
      { "type": "split", "paths": [
        { "label": "Tech", "steps": [
          { "type": "filter", "conditions": [{ "fieldApiName": "industry", "operator": "equals", "value": "Technology" }] },
          { "type": "assign", "assignmentType": "USER", "assigneeId": "user-tech" }
        ]},
        { "label": "Finance", "steps": [
          { "type": "filter", "conditions": [{ "fieldApiName": "industry", "operator": "equals", "value": "Finance" }] },
          { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-finance" }
        ]}
      ], "defaultOwner": { "assignmentType": "ROUND_ROBIN", "assigneeId": "team-ent-general" }}
    ]
  },
  {
    "label": "SMB", "priority": 1, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-smb",
    "conditions": [{ "groupId": "g1", "fieldName": "numberofemployees", "fieldType": "NUMBER", "operator": "lt", "value": "100" }],
    "steps": [
      { "type": "filter", "conditions": [{ "fieldApiName": "numberofemployees", "operator": "lt", "value": "100" }] },
      { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-smb" }
    ]
  }],
  "confirm": true
}`,
  inputSchema: {
    type: "object" as const,
    properties: {
      ruleId: {
        type: "string",
        description: "The ID of the routing rule to update",
      },
      name: { type: "string", description: "New name" },
      status: { type: "string", description: "New status (ACTIVE, INACTIVE)" },
      priority: { type: "number", description: "New priority" },
      triggerEvent: {
        type: "string",
        enum: ["INSERT", "UPDATE", "BOTH", "SEARCH"],
        description: "New trigger event. SEARCH = scheduled/search-based, others = real-time.",
      },
      conditions: {
        type: "array",
        description: "Replacement conditions array (replaces ALL existing conditions)",
        items: { type: "object" },
      },
      branches: {
        type: "array",
        description: "Replacement branches array (replaces ALL existing branches). Each branch: { label, priority, assignmentType (USER/ROUND_ROBIN/QUEUE), assigneeUserId/assigneeTeamId/assigneeQueueId, conditions[], steps[] }. Use steps with nested split for multi-level routing.",
        items: { type: "object" },
      },
      scheduleFrequency: {
        type: "string",
        enum: ["ONE_TIME", "DAILY", "WEEKLY", "MONTHLY"],
        description: "For SEARCH rules: how often to run.",
      },
      matchConfig: {
        type: "object",
        description: "Matching/deduplication config. Set to configure lead-to-lead/contact/account matching. Set to null to remove. See create_rule for full schema.",
      },
      isDryRun: { type: "boolean", description: "If true, set rule to dry-run mode" },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the update. Defaults to false (preview only).",
      },
    },
    required: ["ruleId"],
  },
};

export async function handleUpdateRule(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { ruleId, confirm, ...updates } = args;

  // Auto-set routeType based on triggerEvent (same logic as create_rule)
  if (updates.triggerEvent === "SEARCH") {
    updates.routeType = "SCHEDULED";
    updates.scheduleFrequency = updates.scheduleFrequency || "ONE_TIME";
  } else if (updates.triggerEvent) {
    updates.routeType = "REALTIME";
  }

  // Auto-derive searchCriteria from branch conditions for SEARCH rules
  if (updates.triggerEvent === "SEARCH" && !updates.searchCriteria && updates.branches?.length) {
    const seen = new Set<string>();
    const searchConditions: any[] = [];
    for (const branch of updates.branches) {
      for (const cond of branch.conditions || []) {
        const key = `${cond.fieldName}:${cond.operator}:${cond.value}`;
        if (!seen.has(key)) {
          seen.add(key);
          searchConditions.push({
            id: `sc-${searchConditions.length}`,
            conditions: [{
              fieldApiName: cond.fieldName,
              fieldType: cond.fieldType || "TEXT",
              operator: cond.operator,
              value: cond.value ?? null,
            }],
          });
        }
      }
    }
    if (searchConditions.length > 0) {
      updates.searchCriteria = searchConditions;
    }
  }

  // Ensure branches have proper groupIds on conditions
  if (updates.branches) {
    updates.branches = updates.branches.map((b: any, bi: number) => ({
      ...b,
      priority: b.priority ?? bi,
      conditions: (b.conditions || []).map((c: any, ci: number) => ({
        groupId: c.groupId || `g${bi + 1}`,
        fieldName: c.fieldName,
        fieldType: c.fieldType || "TEXT",
        operator: c.operator,
        value: c.value ?? null,
        sortOrder: c.sortOrder ?? ci,
      })),
    }));
  }

  // Ensure conditions have groupIds
  if (updates.conditions) {
    updates.conditions = updates.conditions.map((c: any, ci: number) => ({
      groupId: c.groupId || "g1",
      fieldName: c.fieldName,
      fieldType: c.fieldType || "TEXT",
      operator: c.operator,
      value: c.value ?? null,
      sortOrder: c.sortOrder ?? ci,
    }));
  }

  if (!confirm) {
    const current = await web.getRule(ruleId);
    const lines = [`Will update rule: ${current.name} (${ruleId})`, "", "Changes:"];
    for (const [key, value] of Object.entries(updates)) {
      const before = (current as any)[key];
      const beforeStr = typeof before === "object" ? JSON.stringify(before) : String(before ?? "—");
      const afterStr = typeof value === "object" ? JSON.stringify(value) : String(value);
      lines.push(`  ${key}: ${beforeStr} -> ${afterStr}`);
    }
    logger.log({ tool: "update_rule", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.updateRule(ruleId, updates);
  logger.log({ tool: "update_rule", action: "execute", input: args, result, durationMs: Date.now() - start });
  return successResponse(`Rule updated successfully.\nID: ${result.id}\nName: ${result.name}`);
}
