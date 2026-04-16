import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";
import { randomUUID } from "node:crypto";

export const createRuleTool = {
  name: "create_rule",
  description: `Create a new routing rule. First call without confirm to preview, then call with confirm: true to execute.

IMPORTANT: triggerEvent determines how the rule fires:
- "SEARCH" = Search-based rule (queries CRM for matching records). Sets routeType=SCHEDULED automatically.
- "INSERT" / "UPDATE" / "BOTH" = Real-time trigger (fires on CRM events). Sets routeType=REALTIME.

For SEARCH rules, also set scheduleFrequency: "ONE_TIME", "DAILY", "WEEKLY", or "MONTHLY".

Branch conditions use groupId to group AND/OR logic: conditions with the SAME groupId are AND'd together, different groupIds are OR'd.

Example: Search HubSpot contacts with firstname containing "A", assign to round robin:
{
  "name": "A-Name Contacts",
  "objectType": "CONTACT",
  "triggerEvent": "SEARCH",
  "scheduleFrequency": "ONE_TIME",
  "branches": [{
    "label": "A-Names",
    "priority": 0,
    "assignmentType": "ROUND_ROBIN",
    "assigneeTeamId": "team-id",
    "conditions": [
      { "groupId": "g1", "fieldName": "firstname", "fieldType": "TEXT", "operator": "contains", "value": "A" }
    ]
  }],
  "confirm": true
}

matchConfig enables lead-to-lead/contact/account matching (deduplication). Example:
{
  "checkLeads": true, "checkContacts": true, "checkAccounts": false,
  "matchEmail": true, "matchPhone": false, "matchDomain": false, "matchCompanyName": false,
  "fuzzyMatchMode": "STRICT",
  "onLeadMatch": "SFDC_MERGE",
  "onContactMatch": "ASSIGN_TO_OWNER",
  "onAccountMatch": "SKIP"
}`,
  inputSchema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Name for the routing rule",
      },
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT"],
        description: "Salesforce object type this rule applies to",
      },
      triggerEvent: {
        type: "string",
        enum: ["INSERT", "UPDATE", "BOTH", "SEARCH"],
        description: "Event that triggers this rule",
      },
      conditions: {
        type: "array",
        description: "Legacy conditions (use branches instead for new rules)",
        items: { type: "object" },
      },
      branches: {
        type: "array",
        description: "Assignment branches. Each has label, priority, assignmentType (USER/ROUND_ROBIN/QUEUE), assigneeUserId/assigneeTeamId/assigneeQueueId, and conditions array",
        items: { type: "object" },
      },
      matchConfig: {
        type: "object",
        description: "Matching/deduplication config. Check against: checkLeads, checkContacts, checkAccounts (booleans). Match on: matchEmail, matchPhone, matchDomain, matchCompanyName (booleans). fuzzyMatchMode: STRICT|FUZZY|AI_SMART. Actions — onLeadMatch: SFDC_MERGE|ASSIGN_TO_OWNER|ASSIGN_CUSTOM, onContactMatch: ASSIGN_TO_OWNER|ASSIGN_CUSTOM|SKIP, onAccountMatch: ASSIGN_TO_OWNER|ASSIGN_CUSTOM|SKIP. For ASSIGN_CUSTOM, include leadAssignmentType/contactAssignmentType/accountAssignmentType (USER|ROUND_ROBIN|QUEUE) and the corresponding assignee ID.",
        properties: {
          checkLeads: { type: "boolean" },
          checkContacts: { type: "boolean" },
          checkAccounts: { type: "boolean" },
          matchEmail: { type: "boolean" },
          matchPhone: { type: "boolean" },
          matchDomain: { type: "boolean" },
          matchCompanyName: { type: "boolean" },
          fuzzyMatchMode: { type: "string", enum: ["STRICT", "FUZZY", "AI_SMART"] },
          onLeadMatch: { type: "string", enum: ["SFDC_MERGE", "ASSIGN_TO_OWNER", "ASSIGN_CUSTOM"] },
          leadAssignmentType: { type: "string", enum: ["USER", "ROUND_ROBIN", "QUEUE"] },
          leadAssigneeUserId: { type: "string" },
          leadAssigneeTeamId: { type: "string" },
          leadAssigneeQueueId: { type: "string" },
          onContactMatch: { type: "string", enum: ["ASSIGN_TO_OWNER", "ASSIGN_CUSTOM", "SKIP"] },
          contactAssignmentType: { type: "string", enum: ["USER", "ROUND_ROBIN", "QUEUE"] },
          contactAssigneeUserId: { type: "string" },
          contactAssigneeTeamId: { type: "string" },
          contactAssigneeQueueId: { type: "string" },
          onAccountMatch: { type: "string", enum: ["ASSIGN_TO_OWNER", "ASSIGN_CUSTOM", "SKIP"] },
          accountAssignmentType: { type: "string", enum: ["USER", "ROUND_ROBIN", "QUEUE"] },
          accountAssigneeUserId: { type: "string" },
          accountAssigneeTeamId: { type: "string" },
          accountAssigneeQueueId: { type: "string" },
        },
      },
      scheduleFrequency: {
        type: "string",
        enum: ["ONE_TIME", "DAILY", "WEEKLY", "MONTHLY"],
        description: "For SEARCH rules: how often to run. Required when triggerEvent is SEARCH.",
      },
      isDryRun: {
        type: "boolean",
        description: "If true, the rule logs but doesn't actually assign in CRM",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the creation. Defaults to false (preview only).",
      },
    },
    required: ["name", "objectType", "triggerEvent"],
  },
};

export async function handleCreateRule(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { confirm, ...data } = args;

  // Auto-set routeType based on triggerEvent
  if (data.triggerEvent === "SEARCH") {
    data.routeType = "SCHEDULED";
    data.scheduleFrequency = data.scheduleFrequency || "ONE_TIME";
  } else {
    data.routeType = "REALTIME";
  }

  // Ensure branches have proper groupIds on conditions
  if (data.branches) {
    data.branches = data.branches.map((b: any, bi: number) => ({
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
  if (data.conditions) {
    data.conditions = data.conditions.map((c: any, ci: number) => ({
      groupId: c.groupId || "g1",
      fieldName: c.fieldName,
      fieldType: c.fieldType || "TEXT",
      operator: c.operator,
      value: c.value ?? null,
      sortOrder: c.sortOrder ?? ci,
    }));
  }

  if (!confirm) {
    const lines = [
      "Will create routing rule:",
      `  Name: ${data.name}`,
      `  Object Type: ${data.objectType}`,
      `  Trigger Event: ${data.triggerEvent}`,
    ];
    if (data.conditions?.length) lines.push(`  Conditions: ${data.conditions.length} condition(s)`);
    if (data.branches?.length) {
      lines.push(`  Branches:`);
      for (const b of data.branches) {
        lines.push(`    - ${b.label || "Unnamed"}: ${b.assignmentType} | ${b.conditions?.length || 0} condition(s)`);
      }
    }
    if (data.matchConfig) {
      const mc = data.matchConfig;
      const checkAgainst = [mc.checkLeads && "Leads", mc.checkContacts && "Contacts", mc.checkAccounts && "Accounts"].filter(Boolean).join(", ");
      const matchOn = [mc.matchEmail && "Email", mc.matchPhone && "Phone", mc.matchDomain && "Domain", mc.matchCompanyName && "Company Name"].filter(Boolean).join(", ");
      lines.push(`  Match Config:`);
      lines.push(`    Check against: ${checkAgainst || "none"}`);
      lines.push(`    Match on: ${matchOn || "none"} (${mc.fuzzyMatchMode || "STRICT"})`);
      if (mc.onLeadMatch) lines.push(`    On lead match: ${mc.onLeadMatch}`);
      if (mc.onContactMatch) lines.push(`    On contact match: ${mc.onContactMatch}`);
      if (mc.onAccountMatch) lines.push(`    On account match: ${mc.onAccountMatch}`);
    }
    if (data.isDryRun) lines.push(`  Dry Run: true`);
    logger.log({ tool: "create_rule", action: "preview", input: data, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.createRule(data);
  const rule = result.rule || result;
  logger.log({ tool: "create_rule", action: "execute", input: data, result, durationMs: Date.now() - start });
  return successResponse(`Rule created successfully.\nID: ${rule.id}\nName: ${rule.name}`);
}
