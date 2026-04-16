import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const updateRuleTool = {
  name: "update_rule",
  description: `Update an existing routing rule. First call without confirm to see before/after diff, then call with confirm: true to execute.

IMPORTANT: When updating branches or conditions, you REPLACE the entire array — there is no merge/patch.
Always call get_rule first to see the current state, then send the complete updated branches array.

PREREQUISITE: ALWAYS call list_fields with the objectType FIRST to get the actual field API names available.
DO NOT guess field names — they differ between CONTACT, COMPANY, and DEAL objects.

COMMON FIELDS BY OBJECT TYPE (call list_fields for the actual list):
- CONTACT: email, firstname, lastname, phone, jobtitle, lifecyclestage, hs_lead_status, hubspotscore, hs_analytics_source, country, city, state, company, notes_last_contacted, createdate, lastmodifieddate
- COMPANY: name, domain, industry, numberofemployees, annualrevenue, country, city, state, phone, website, type, founded_year
- DEAL: dealname, dealstage, amount, closedate, pipeline, hs_deal_stage_probability
DO NOT use Company fields (industry, numberofemployees, annualrevenue) on Contact rules — they will not match.

triggerEvent determines how the rule fires:
- "SEARCH" = Search-based rule (queries CRM for matching records). Sets routeType=SCHEDULED automatically.
- "INSERT" / "UPDATE" / "BOTH" = Real-time trigger (fires on CRM events). Sets routeType=REALTIME.

OPERATORS: equals, not_equals, contains, not_contains, starts_with, gt, lt, gte, lte, before, after, within_last, includes (semicolon-separated multi-value), excludes, is_blank, is_not_blank, is_true, is_false, fuzzy_equals, sounds_like

CONDITION LOGIC: conditions with the SAME groupId are AND'd together, different groupIds are OR'd.

ASSIGNMENT TYPES: USER (assigneeUserId), ROUND_ROBIN (assigneeTeamId), QUEUE (assigneeQueueId)

FIELD UPDATES (FULLY SUPPORTED — DO NOT SKIP):
The "updateField" step type IS supported and SHOULD be used. It writes values back to the CRM record.
Use it to stamp routing metadata (e.g. status, tier) on records as they are routed.

NESTED ROUTING (CRITICAL):
Use "steps" array with nested "split" steps for multi-level routing. DO NOT flatten into separate branches.

Step types (ALL are supported — use them):
- "filter" — { "type": "filter", "conditions": [{ "fieldApiName": "field", "operator": "op", "value": "val" }] }
- "updateField" — { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "field", "fieldValue": "value" }] }
- "assign" — { "type": "assign", "assignmentType": "USER"|"ROUND_ROBIN", "assigneeId": "id" or "teamId": "id" }
- "split" — { "type": "split", "paths": [{ "label": "...", "steps": [...] }], "defaultOwner": { "assignmentType": "...", "assigneeId": "..." } }

EXAMPLE — COMPANY rule: Adding a nested split with field updates:
{
  "ruleId": "rule-123",
  "branches": [{
    "label": "Enterprise", "priority": 0, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-ent",
    "conditions": [{ "groupId": "g1", "fieldName": "numberofemployees", "fieldType": "NUMBER", "operator": "gte", "value": "500" }],
    "steps": [
      { "type": "filter", "conditions": [{ "fieldApiName": "numberofemployees", "operator": "gte", "value": "500" }] },
      { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "type", "fieldValue": "Enterprise" }] },
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
