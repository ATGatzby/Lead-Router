import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";
import { randomUUID } from "node:crypto";

// ─── Tree → branches+steps converter ────────────────────────────────────────
// Converts the simple tree input into the V2 branches+steps format the API expects.

interface TreeNode {
  label: string;
  condition?: { fieldApiName: string; fieldType?: string; operator: string; value: string };
  fieldUpdates?: Array<{ fieldApiName: string; fieldValue: string }>;
  // Leaf assignment:
  assignmentType?: string;
  assigneeId?: string;
  teamId?: string;
  queueId?: string;
  // Non-leaf: more nesting:
  paths?: TreeNode[];
  defaultOwner?: { assignmentType: string; assigneeId?: string; teamId?: string };
}

function treeNodeToSteps(node: TreeNode): any[] {
  const steps: any[] = [];

  // Filter step from condition
  // UI expects conditions as ConditionGroup[] format: [{ id, conditions: [{ fieldApiName, operator, value }] }]
  if (node.condition) {
    const groupId = randomUUID();
    steps.push({
      type: "filter",
      conditions: [{
        id: groupId,
        conjunction: "AND",
        conditions: [{
          id: randomUUID(),
          groupId,
          fieldApiName: node.condition.fieldApiName,
          fieldType: node.condition.fieldType || "TEXT",
          operator: node.condition.operator,
          value: node.condition.value ?? "",
        }],
      }],
    });
  }

  // Field updates — UI expects fieldLabel and fieldType on each update
  if (node.fieldUpdates?.length) {
    steps.push({
      type: "updateField",
      fieldUpdates: node.fieldUpdates.map(fu => ({
        fieldApiName: fu.fieldApiName,
        fieldLabel: fu.fieldApiName, // best-effort label
        fieldType: "TEXT",
        fieldValue: fu.fieldValue,
      })),
    });
  }

  // If leaf: assign step
  // UI expects assigneeId for ALL types (USER, ROUND_ROBIN, QUEUE) — it checks assigneeId to show "configured"
  if (node.assignmentType && !node.paths?.length) {
    const id = node.assigneeId || node.teamId || node.queueId || null;
    steps.push({
      type: "assign",
      assignmentType: node.assignmentType,
      assigneeId: id,
      assigneeName: null, // resolved by UI on display
    });
  }

  // If non-leaf: split step with nested paths
  // UI expects each path to be a full RoutePath: { id, label, conditions, action, steps }
  if (node.paths?.length) {
    const split: any = {
      type: "split",
      paths: node.paths.map(child => {
        const childSteps = treeNodeToSteps(child);
        // Find the assign step (if leaf) for the legacy action fallback
        const assignStep = childSteps.find((s: any) => s.type === "assign");
        return {
          id: randomUUID(),
          label: child.label,
          conditions: [], // conditions live in filter steps
          action: assignStep
            ? { assignmentType: assignStep.assignmentType, assigneeId: assignStep.assigneeId, assigneeName: assignStep.assigneeName }
            : { assignmentType: null, assigneeId: null, assigneeName: null },
          steps: childSteps,
        };
      }),
      defaultOwner: node.defaultOwner
        ? { assignmentType: node.defaultOwner.assignmentType, assigneeId: node.defaultOwner.teamId || node.defaultOwner.assigneeId || null, assigneeName: null }
        : null,
    };
    steps.push(split);
  }

  return steps;
}

function convertTreeToBranches(tree: TreeNode[]): any[] {
  return tree.map((rootNode, i) => {
    const steps = treeNodeToSteps(rootNode);

    // Build branch-level condition from root node's condition (for flat evaluation fallback)
    const conditions: any[] = [];
    if (rootNode.condition) {
      conditions.push({
        groupId: `g${i + 1}`,
        fieldName: rootNode.condition.fieldApiName,
        fieldType: rootNode.condition.fieldType || "TEXT",
        operator: rootNode.condition.operator,
        value: rootNode.condition.value,
      });
    }

    // Find the deepest/first leaf assignment as branch-level fallback
    const findLeafAssignment = (node: TreeNode): any => {
      if (node.assignmentType && !node.paths?.length) {
        return {
          assignmentType: node.assignmentType,
          assigneeUserId: node.assignmentType === "USER" ? node.assigneeId : undefined,
          assigneeTeamId: node.assignmentType === "ROUND_ROBIN" ? (node.teamId || node.assigneeId) : undefined,
          assigneeQueueId: node.assignmentType === "QUEUE" ? (node.queueId || node.assigneeId) : undefined,
        };
      }
      if (node.paths?.length) {
        for (const child of node.paths) {
          const found = findLeafAssignment(child);
          if (found) return found;
        }
      }
      return null;
    };

    const leafAssignment = findLeafAssignment(rootNode) || { assignmentType: "ROUND_ROBIN" };

    return {
      label: rootNode.label,
      priority: i,
      ...leafAssignment,
      conditions,
      steps,
    };
  });
}

// ─── Tool definition ─────────────────────────────────────────────────────────

export const createRuleTool = {
  name: "create_rule",
  description: `Create a new routing rule. First call without confirm to preview, then call with confirm: true to execute.

CRITICAL RULES — DO NOT SKIP:
1. ALWAYS call get_license_info FIRST to determine the connected CRM type (returns "CRM Type: SALESFORCE" or "CRM Type: HUBSPOT"). DO NOT assume Salesforce.
2. ALWAYS call list_fields with the objectType to get actual field API names. DO NOT guess fields.
3. ALWAYS call list_teams and list_users to get real team/user IDs for assignments. DO NOT hallucinate IDs.
4. If the user's request is ambiguous (e.g. unclear object type, unclear assignment), ASK for clarification instead of guessing.

objectType depends on the connected CRM:
- Salesforce: "LEAD", "CONTACT", "ACCOUNT"
- HubSpot: "CONTACT", "COMPANY", "DEAL"

triggerEvent: "SEARCH" = scheduled, "INSERT"/"UPDATE"/"BOTH" = real-time.
For SEARCH, also set scheduleFrequency: "ONE_TIME", "DAILY", "WEEKLY", or "MONTHLY".

OPERATORS: equals, not_equals, contains, not_contains, starts_with, gt, lt, gte, lte, before, after, within_last, includes (semicolon-separated), excludes, is_blank, is_not_blank, is_true, is_false

TWO WAYS TO DEFINE ROUTING:

1. "branches" — Simple flat rules (1-2 branches, no nesting needed).
2. "tree" — NESTED/HIERARCHICAL routing with field updates at each level. USE THIS for multi-level splits.

The "tree" parameter is an array of root nodes. Each node has:
- label: display name
- condition: { fieldApiName, operator, value } — what this node matches
- fieldUpdates: [{ fieldApiName, fieldValue }] — CRM field writes at this level (SUPPORTED)
- paths: [...child nodes...] — nested sub-splits (non-leaf)
- assignmentType + teamId/assigneeId/queueId — who to assign to (leaf nodes)
- defaultOwner: { assignmentType, teamId } — fallback if no child path matches

The handler converts the tree into the API's nested steps/splits format automatically.

────────────────────────────────────────────────
EXAMPLE 1: COMPANY — Simple 2-branch with field updates (use "branches")
────────────────────────────────────────────────
{
  "name": "Enterprise vs SMB",
  "objectType": "COMPANY",
  "triggerEvent": "BOTH",
  "branches": [
    {
      "label": "Enterprise", "priority": 0, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-ent",
      "conditions": [{ "groupId": "g1", "fieldName": "annualrevenue", "fieldType": "NUMBER", "operator": "gte", "value": "1000000" }],
      "steps": [
        { "type": "filter", "conditions": [{ "fieldApiName": "annualrevenue", "operator": "gte", "value": "1000000" }] },
        { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "type", "fieldValue": "Enterprise" }] },
        { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-ent" }
      ]
    },
    {
      "label": "SMB", "priority": 1, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-smb",
      "conditions": [{ "groupId": "g1", "fieldName": "annualrevenue", "fieldType": "NUMBER", "operator": "lt", "value": "100000" }],
      "steps": [
        { "type": "filter", "conditions": [{ "fieldApiName": "annualrevenue", "operator": "lt", "value": "100000" }] },
        { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "type", "fieldValue": "SMB" }] },
        { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-smb" }
      ]
    }
  ]
}

────────────────────────────────────────────────
EXAMPLE 2: COMPANY — 3-Level nested tree (Region → Size → Industry) — USE "tree"
────────────────────────────────────────────────
{
  "name": "Region-Size-Industry Router",
  "objectType": "COMPANY",
  "triggerEvent": "BOTH",
  "tree": [
    {
      "label": "US",
      "condition": { "fieldApiName": "country", "operator": "equals", "value": "US" },
      "fieldUpdates": [{ "fieldApiName": "type", "fieldValue": "US" }],
      "paths": [
        {
          "label": "Enterprise",
          "condition": { "fieldApiName": "numberofemployees", "operator": "gte", "value": "1000" },
          "fieldUpdates": [{ "fieldApiName": "description", "fieldValue": "Enterprise" }],
          "paths": [
            {
              "label": "Tech",
              "condition": { "fieldApiName": "industry", "operator": "equals", "value": "Technology" },
              "assignmentType": "ROUND_ROBIN", "teamId": "team-us-ent-tech"
            },
            {
              "label": "Finance",
              "condition": { "fieldApiName": "industry", "operator": "equals", "value": "Finance" },
              "assignmentType": "ROUND_ROBIN", "teamId": "team-us-ent-fin"
            }
          ],
          "defaultOwner": { "assignmentType": "ROUND_ROBIN", "teamId": "team-us-ent" }
        },
        {
          "label": "SMB",
          "condition": { "fieldApiName": "numberofemployees", "operator": "lt", "value": "100" },
          "assignmentType": "ROUND_ROBIN", "teamId": "team-us-smb"
        }
      ]
    },
    {
      "label": "EMEA",
      "condition": { "fieldApiName": "country", "operator": "includes", "value": "United Kingdom;Germany;France" },
      "fieldUpdates": [{ "fieldApiName": "type", "fieldValue": "EMEA" }],
      "paths": [
        {
          "label": "Enterprise",
          "condition": { "fieldApiName": "numberofemployees", "operator": "gte", "value": "1000" },
          "assignmentType": "ROUND_ROBIN", "teamId": "team-emea-ent"
        },
        {
          "label": "SMB",
          "condition": { "fieldApiName": "numberofemployees", "operator": "lt", "value": "100" },
          "assignmentType": "ROUND_ROBIN", "teamId": "team-emea-smb"
        }
      ]
    }
  ]
}

────────────────────────────────────────────────
EXAMPLE 3: CONTACT — 4-Level tree (Source → Stage → Score → Country)
────────────────────────────────────────────────
{
  "name": "Full Funnel Router",
  "objectType": "CONTACT",
  "triggerEvent": "BOTH",
  "tree": [
    {
      "label": "Inbound",
      "condition": { "fieldApiName": "hs_analytics_source", "operator": "includes", "value": "ORGANIC_SEARCH;PAID_SEARCH;SOCIAL_MEDIA" },
      "fieldUpdates": [{ "fieldApiName": "hs_lead_status", "fieldValue": "NEW" }],
      "paths": [
        {
          "label": "MQL",
          "condition": { "fieldApiName": "lifecyclestage", "operator": "equals", "value": "marketingqualifiedlead" },
          "paths": [
            {
              "label": "High Score",
              "condition": { "fieldApiName": "hubspotscore", "operator": "gte", "value": "80" },
              "fieldUpdates": [{ "fieldApiName": "hs_lead_status", "fieldValue": "IN_PROGRESS" }],
              "paths": [
                { "label": "US", "condition": { "fieldApiName": "country", "operator": "equals", "value": "US" }, "assignmentType": "USER", "assigneeId": "user-us-sdr" },
                { "label": "EMEA", "condition": { "fieldApiName": "country", "operator": "includes", "value": "United Kingdom;Germany;France" }, "assignmentType": "ROUND_ROBIN", "teamId": "team-emea-sdr" }
              ],
              "defaultOwner": { "assignmentType": "ROUND_ROBIN", "teamId": "team-global-sdr" }
            },
            { "label": "Low Score", "assignmentType": "ROUND_ROBIN", "teamId": "team-nurture" }
          ]
        },
        {
          "label": "SQL",
          "condition": { "fieldApiName": "lifecyclestage", "operator": "equals", "value": "salesqualifiedlead" },
          "assignmentType": "ROUND_ROBIN", "teamId": "team-ae"
        }
      ]
    }
  ]
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
        enum: ["LEAD", "CONTACT", "ACCOUNT", "COMPANY", "DEAL"],
        description: "CRM object type. Salesforce: LEAD, CONTACT, ACCOUNT. HubSpot: CONTACT, COMPANY, DEAL. Check which CRM is connected first.",
      },
      triggerEvent: {
        type: "string",
        enum: ["INSERT", "UPDATE", "BOTH", "SEARCH"],
        description: "Event that triggers this rule",
      },
      tree: {
        type: "array",
        description: "NESTED routing tree — use for multi-level splits with field updates. Each node: { label, condition: {fieldApiName, operator, value}, fieldUpdates: [{fieldApiName, fieldValue}], paths: [...children], assignmentType, teamId/assigneeId }. The handler converts this to the API format automatically.",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Node display name" },
            condition: {
              type: "object",
              description: "Match condition: { fieldApiName, operator, value, fieldType? }",
              properties: {
                fieldApiName: { type: "string" },
                operator: { type: "string" },
                value: { type: "string" },
                fieldType: { type: "string" },
              },
            },
            fieldUpdates: {
              type: "array",
              description: "CRM field writes at this level: [{ fieldApiName, fieldValue }]",
              items: {
                type: "object",
                properties: {
                  fieldApiName: { type: "string" },
                  fieldValue: { type: "string" },
                },
              },
            },
            assignmentType: { type: "string", enum: ["USER", "ROUND_ROBIN", "QUEUE"], description: "Leaf assignment type" },
            assigneeId: { type: "string", description: "For USER assignment" },
            teamId: { type: "string", description: "For ROUND_ROBIN assignment" },
            queueId: { type: "string", description: "For QUEUE assignment" },
            paths: {
              type: "array",
              description: "Child nodes for further nesting",
              items: { type: "object" },
            },
            defaultOwner: {
              type: "object",
              description: "Fallback assignment if no child path matches",
              properties: {
                assignmentType: { type: "string" },
                teamId: { type: "string" },
                assigneeId: { type: "string" },
              },
            },
          },
        },
      },
      branches: {
        type: "array",
        description: "Simple flat branches — use for 1-2 branch rules without nesting. For multi-level routing, use 'tree' instead.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            priority: { type: "number" },
            assignmentType: { type: "string", enum: ["USER", "ROUND_ROBIN", "QUEUE"] },
            assigneeUserId: { type: "string" },
            assigneeTeamId: { type: "string" },
            assigneeQueueId: { type: "string" },
            conditions: { type: "array", items: { type: "object" } },
            steps: { type: "array", items: { type: "object" } },
          },
        },
      },
      conditions: {
        type: "array",
        description: "Legacy conditions (use branches or tree instead)",
        items: { type: "object" },
      },
      matchConfig: {
        type: "object",
        description: "Matching/deduplication config. See description for schema.",
      },
      scheduleFrequency: {
        type: "string",
        enum: ["ONE_TIME", "DAILY", "WEEKLY", "MONTHLY"],
        description: "For SEARCH rules: how often to run.",
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

// Map Salesforce ↔ HubSpot object types
const SFDC_TO_HUBSPOT: Record<string, string> = { LEAD: "CONTACT", ACCOUNT: "COMPANY" };
const HUBSPOT_TO_SFDC: Record<string, string> = { COMPANY: "ACCOUNT", DEAL: "LEAD" };

async function autoMapObjectType(web: WebClient, objectType: string): Promise<string> {
  try {
    const license = await web.getLicenseInfo() as any;
    const crmType = license?.crmType ?? "SALESFORCE";
    if (crmType === "HUBSPOT" && SFDC_TO_HUBSPOT[objectType]) {
      return SFDC_TO_HUBSPOT[objectType];
    }
    if (crmType === "SALESFORCE" && HUBSPOT_TO_SFDC[objectType]) {
      return HUBSPOT_TO_SFDC[objectType];
    }
  } catch {
    // ignore — use original objectType
  }
  return objectType;
}

export async function handleCreateRule(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { confirm, ...data } = args;

  // Auto-map objectType based on CRM (e.g. ACCOUNT → COMPANY for HubSpot)
  if (data.objectType) {
    data.objectType = await autoMapObjectType(web, data.objectType);
  }

  // Convert tree → branches+steps if tree parameter is provided
  if (data.tree?.length) {
    data.branches = convertTreeToBranches(data.tree);
    delete data.tree;
  }

  // Auto-set routeType based on triggerEvent
  if (data.triggerEvent === "SEARCH") {
    data.routeType = "SCHEDULED";
    data.scheduleFrequency = data.scheduleFrequency || "ONE_TIME";
  } else {
    data.routeType = "REALTIME";
  }

  // Auto-derive searchCriteria from branch conditions for SEARCH rules.
  if (data.triggerEvent === "SEARCH" && !data.searchCriteria && data.branches?.length) {
    const seen = new Set<string>();
    const searchConditions: any[] = [];
    for (const branch of data.branches) {
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
      data.searchCriteria = searchConditions;
    }
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
        const hasSteps = b.steps?.length > 0;
        const stepSummary = hasSteps ? ` | ${b.steps.length} step(s)` : "";
        lines.push(`    - ${b.label || "Unnamed"}: ${b.assignmentType} | ${b.conditions?.length || 0} condition(s)${stepSummary}`);
        // Show nested split depth
        if (hasSteps) {
          const countSplits = (steps: any[]): number => {
            let depth = 0;
            for (const s of steps) {
              if (s.type === "split" && s.paths?.length) {
                for (const p of s.paths) {
                  if (p.steps) depth = Math.max(depth, 1 + countSplits(p.steps));
                }
              }
            }
            return depth;
          };
          const splitDepth = countSplits(b.steps);
          if (splitDepth > 0) lines.push(`      Nesting depth: ${splitDepth} level(s)`);
        }
      }
    }
    if (data.matchConfig) {
      const mc = data.matchConfig;
      const checkAgainst = [mc.checkLeads && "Leads", mc.checkContacts && "Contacts", mc.checkAccounts && "Accounts"].filter(Boolean).join(", ");
      const matchOn = [mc.matchEmail && "Email", mc.matchPhone && "Phone", mc.matchDomain && "Domain", mc.matchCompanyName && "Company Name"].filter(Boolean).join(", ");
      lines.push(`  Match Config:`);
      lines.push(`    Check against: ${checkAgainst || "none"}`);
      lines.push(`    Match on: ${matchOn || "none"} (${mc.fuzzyMatchMode || "STRICT"})`);
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
