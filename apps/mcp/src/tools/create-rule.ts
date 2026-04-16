import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";
import { randomUUID } from "node:crypto";

export const createRuleTool = {
  name: "create_rule",
  description: `Create a new routing rule. First call without confirm to preview, then call with confirm: true to execute.

PREREQUISITE: ALWAYS call list_fields with the objectType FIRST to get the actual field API names available.
DO NOT guess field names — they differ between CONTACT, COMPANY, and DEAL objects.
Only use fields that list_fields returns. Custom fields require the exact API name from the CRM.

COMMON FIELDS BY OBJECT TYPE (call list_fields for the actual list):
- CONTACT: email, firstname, lastname, phone, jobtitle, lifecyclestage, hs_lead_status, hubspotscore, hs_analytics_source, country, city, state, company, notes_last_contacted, createdate, lastmodifieddate
- COMPANY: name, domain, industry, numberofemployees, annualrevenue, country, city, state, phone, website, type, founded_year
- DEAL: dealname, dealstage, amount, closedate, pipeline, hs_deal_stage_probability
DO NOT use Company fields (industry, numberofemployees, annualrevenue) on Contact rules — they will not match.

IMPORTANT: triggerEvent determines how the rule fires:
- "SEARCH" = Search-based rule (queries CRM for matching records). Sets routeType=SCHEDULED automatically.
- "INSERT" / "UPDATE" / "BOTH" = Real-time trigger (fires on CRM events). Sets routeType=REALTIME.

For SEARCH rules, also set scheduleFrequency: "ONE_TIME", "DAILY", "WEEKLY", or "MONTHLY".

OPERATORS: equals, not_equals, contains, not_contains, starts_with, gt, lt, gte, lte, before, after, within_last, includes (semicolon-separated multi-value), excludes, is_blank, is_not_blank, is_true, is_false, fuzzy_equals, sounds_like

FIELD TYPES: TEXT, NUMBER, DATE, BOOLEAN, PICKLIST

CONDITION LOGIC: conditions with the SAME groupId are AND'd together, different groupIds are OR'd.

ASSIGNMENT TYPES: USER (assigneeUserId), ROUND_ROBIN (assigneeTeamId), QUEUE (assigneeQueueId)

FIELD UPDATES (FULLY SUPPORTED — DO NOT SKIP):
The "updateField" step type IS supported and SHOULD be used. It writes values back to the CRM record.
Use it to stamp routing metadata (e.g. region, tier, status) on records as they are routed.
Every example below includes updateField steps — follow the same pattern.

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
      { type: "updateField", fieldUpdates: [{fieldApiName: "hs_lead_status", fieldValue: "IN_PROGRESS"}] },
      { type: "split", paths: [
        { label: "Enterprise", steps: [
          { type: "filter", conditions: [{fieldApiName: "jobtitle", operator: "contains", value: "VP"}] },
          { type: "split", paths: [
            { label: "Tech", steps: [...filter + assign...] },
            { label: "Other", steps: [...assign...] }
          ]}
        ]},
        { label: "SMB", steps: [...filter + assign...] }
      ]}
    ]
  }]

Step types (ALL are supported — use them):
- "filter" — conditions to match: { "type": "filter", "conditions": [{ "fieldApiName": "field", "operator": "op", "value": "val" }] }
- "updateField" — update CRM fields: { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "field", "fieldValue": "value" }] }
- "assign" — assign to user/team: { "type": "assign", "assignmentType": "USER"|"ROUND_ROBIN", "assigneeId": "id" or "teamId": "id" }
- "split" — nested decision split: { "type": "split", "paths": [{ "label": "...", "steps": [...] }, ...], "defaultOwner": { "assignmentType": "...", "assigneeId": "..." } }

When using steps on a branch, ALSO set the branch-level conditions and assignmentType as fallback.

────────────────────────────────────────────────
EXAMPLE 1: COMPANY — Revenue-tiered with field updates
────────────────────────────────────────────────
{
  "name": "Enterprise vs SMB",
  "objectType": "COMPANY",
  "triggerEvent": "BOTH",
  "branches": [
    {
      "label": "Enterprise", "priority": 0, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-ent",
      "conditions": [
        { "groupId": "g1", "fieldName": "annualrevenue", "fieldType": "NUMBER", "operator": "gte", "value": "1000000" },
        { "groupId": "g1", "fieldName": "numberofemployees", "fieldType": "NUMBER", "operator": "gte", "value": "500" }
      ],
      "steps": [
        { "type": "filter", "conditions": [{ "fieldApiName": "annualrevenue", "operator": "gte", "value": "1000000" }, { "fieldApiName": "numberofemployees", "operator": "gte", "value": "500" }] },
        { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "type", "fieldValue": "Enterprise" }] },
        { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-ent" }
      ]
    },
    {
      "label": "SMB", "priority": 1, "assignmentType": "USER", "assigneeUserId": "user-smb",
      "conditions": [{ "groupId": "g1", "fieldName": "annualrevenue", "fieldType": "NUMBER", "operator": "lt", "value": "100000" }],
      "steps": [
        { "type": "filter", "conditions": [{ "fieldApiName": "annualrevenue", "operator": "lt", "value": "100000" }] },
        { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "type", "fieldValue": "SMB" }] },
        { "type": "assign", "assignmentType": "USER", "assigneeId": "user-smb" }
      ]
    }
  ]
}

────────────────────────────────────────────────
EXAMPLE 2: CONTACT — OR logic (different groupIds = OR) with field update
────────────────────────────────────────────────
{
  "name": "Inbound Lead Router",
  "objectType": "CONTACT",
  "triggerEvent": "INSERT",
  "branches": [{
    "label": "Inbound Leads", "priority": 0, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-sdr",
    "conditions": [
      { "groupId": "g1", "fieldName": "hs_analytics_source", "fieldType": "TEXT", "operator": "equals", "value": "ORGANIC_SEARCH" },
      { "groupId": "g2", "fieldName": "jobtitle", "fieldType": "TEXT", "operator": "contains", "value": "Director" }
    ],
    "steps": [
      { "type": "filter", "conditions": [{ "fieldApiName": "hs_analytics_source", "operator": "equals", "value": "ORGANIC_SEARCH" }] },
      { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "hs_lead_status", "fieldValue": "NEW" }] },
      { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-sdr" }
    ]
  }]
}

────────────────────────────────────────────────
EXAMPLE 3: CONTACT — Search rule (weekly stale re-engagement)
────────────────────────────────────────────────
{
  "name": "Weekly Stale Re-engage",
  "objectType": "CONTACT",
  "triggerEvent": "SEARCH",
  "scheduleFrequency": "WEEKLY",
  "branches": [{
    "label": "90+ days stale", "priority": 0, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-re-engage",
    "conditions": [{ "groupId": "g1", "fieldName": "notes_last_contacted", "fieldType": "DATE", "operator": "before", "value": "2026-01-01" }],
    "steps": [
      { "type": "filter", "conditions": [{ "fieldApiName": "notes_last_contacted", "operator": "before", "value": "2026-01-01" }] },
      { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "hs_lead_status", "fieldValue": "OPEN" }] },
      { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-re-engage" }
    ]
  }]
}

────────────────────────────────────────────────
EXAMPLE 4: CONTACT — Lifecycle stage routing with field updates
────────────────────────────────────────────────
{
  "name": "Lifecycle Router",
  "objectType": "CONTACT",
  "triggerEvent": "UPDATE",
  "branches": [
    {
      "label": "MQL to SDR", "priority": 0, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-sdr",
      "conditions": [{ "groupId": "g1", "fieldName": "lifecyclestage", "fieldType": "TEXT", "operator": "equals", "value": "marketingqualifiedlead" }],
      "steps": [
        { "type": "filter", "conditions": [{ "fieldApiName": "lifecyclestage", "operator": "equals", "value": "marketingqualifiedlead" }] },
        { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "hs_lead_status", "fieldValue": "NEW" }] },
        { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-sdr" }
      ]
    },
    {
      "label": "SQL to AE", "priority": 1, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-ae",
      "conditions": [{ "groupId": "g1", "fieldName": "lifecyclestage", "fieldType": "TEXT", "operator": "equals", "value": "salesqualifiedlead" }],
      "steps": [
        { "type": "filter", "conditions": [{ "fieldApiName": "lifecyclestage", "operator": "equals", "value": "salesqualifiedlead" }] },
        { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "hs_lead_status", "fieldValue": "IN_PROGRESS" }] },
        { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-ae" }
      ]
    }
  ]
}

────────────────────────────────────────────────
EXAMPLE 5: COMPANY — 3-Level nested (Region -> Size -> Industry) with field updates at each level
────────────────────────────────────────────────
{
  "name": "Region-Size-Industry Router",
  "objectType": "COMPANY",
  "triggerEvent": "BOTH",
  "branches": [{
    "label": "Americas", "priority": 0, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-americas",
    "conditions": [{ "groupId": "g1", "fieldName": "country", "fieldType": "TEXT", "operator": "includes", "value": "US;CA;BR;MX" }],
    "steps": [
      { "type": "filter", "conditions": [{ "fieldApiName": "country", "operator": "includes", "value": "US;CA;BR;MX" }] },
      { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "type", "fieldValue": "Americas" }] },
      { "type": "split", "paths": [
        { "label": "Enterprise Americas", "steps": [
          { "type": "filter", "conditions": [{ "fieldApiName": "numberofemployees", "operator": "gte", "value": "1000" }] },
          { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "description", "fieldValue": "Enterprise - Americas" }] },
          { "type": "split", "paths": [
            { "label": "Tech", "steps": [
              { "type": "filter", "conditions": [{ "fieldApiName": "industry", "operator": "equals", "value": "Technology" }] },
              { "type": "assign", "assignmentType": "USER", "assigneeId": "user-tech-ent" }
            ]},
            { "label": "Finance", "steps": [
              { "type": "filter", "conditions": [{ "fieldApiName": "industry", "operator": "equals", "value": "Finance" }] },
              { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-finance" }
            ]}
          ], "defaultOwner": { "assignmentType": "ROUND_ROBIN", "assigneeId": "team-ent-americas" }}
        ]},
        { "label": "SMB Americas", "steps": [
          { "type": "filter", "conditions": [{ "fieldApiName": "numberofemployees", "operator": "lt", "value": "100" }] },
          { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-smb-americas" }
        ]}
      ]}
    ]
  }]
}

────────────────────────────────────────────────
EXAMPLE 6: DEAL — 3-Level (Stage -> Amount -> Urgency) with priority stamping
────────────────────────────────────────────────
{
  "name": "Deal Prioritization",
  "objectType": "DEAL",
  "triggerEvent": "UPDATE",
  "branches": [{
    "label": "Qualified", "priority": 0, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-ae",
    "conditions": [{ "groupId": "g1", "fieldName": "dealstage", "fieldType": "TEXT", "operator": "equals", "value": "qualifiedtobuy" }],
    "steps": [
      { "type": "filter", "conditions": [{ "fieldApiName": "dealstage", "operator": "equals", "value": "qualifiedtobuy" }] },
      { "type": "split", "paths": [
        { "label": "Big Deal >$100K", "steps": [
          { "type": "filter", "conditions": [{ "fieldApiName": "amount", "operator": "gte", "value": "100000" }] },
          { "type": "split", "paths": [
            { "label": "Closing This Month", "steps": [
              { "type": "filter", "conditions": [{ "fieldApiName": "closedate", "operator": "within_last", "value": "30" }] },
              { "type": "assign", "assignmentType": "USER", "assigneeId": "user-vp-sales" }
            ]},
            { "label": "Closing Later", "steps": [
              { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-senior-ae" }
            ]}
          ]}
        ]},
        { "label": "Standard Deal", "steps": [
          { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-ae" }
        ]}
      ]}
    ]
  }]
}

────────────────────────────────────────────────
EXAMPLE 7: CONTACT — 4-Level (Source -> Stage -> Score -> Country) with field updates at each level
────────────────────────────────────────────────
{
  "name": "Full Funnel 4-Level Router",
  "objectType": "CONTACT",
  "triggerEvent": "BOTH",
  "branches": [{
    "label": "Inbound", "priority": 0, "assignmentType": "ROUND_ROBIN", "assigneeTeamId": "team-inbound",
    "conditions": [{ "groupId": "g1", "fieldName": "hs_analytics_source", "fieldType": "TEXT", "operator": "includes", "value": "ORGANIC_SEARCH;PAID_SEARCH;SOCIAL_MEDIA" }],
    "steps": [
      { "type": "filter", "conditions": [{ "fieldApiName": "hs_analytics_source", "operator": "includes", "value": "ORGANIC_SEARCH;PAID_SEARCH;SOCIAL_MEDIA" }] },
      { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "hs_lead_status", "fieldValue": "NEW" }] },
      { "type": "split", "paths": [
        { "label": "MQL", "steps": [
          { "type": "filter", "conditions": [{ "fieldApiName": "lifecyclestage", "operator": "equals", "value": "marketingqualifiedlead" }] },
          { "type": "split", "paths": [
            { "label": "High Score", "steps": [
              { "type": "filter", "conditions": [{ "fieldApiName": "hubspotscore", "operator": "gte", "value": "80" }] },
              { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "hs_lead_status", "fieldValue": "IN_PROGRESS" }] },
              { "type": "split", "paths": [
                { "label": "US", "steps": [
                  { "type": "filter", "conditions": [{ "fieldApiName": "country", "operator": "equals", "value": "US" }] },
                  { "type": "assign", "assignmentType": "USER", "assigneeId": "user-us-senior-sdr" }
                ]},
                { "label": "EMEA", "steps": [
                  { "type": "filter", "conditions": [{ "fieldApiName": "country", "operator": "includes", "value": "United Kingdom;Germany;France" }] },
                  { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-emea-sdr" }
                ]}
              ], "defaultOwner": { "assignmentType": "ROUND_ROBIN", "assigneeId": "team-global-sdr" }}
            ]},
            { "label": "Low Score", "steps": [
              { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "hs_lead_status", "fieldValue": "OPEN" }] },
              { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-nurture" }
            ]}
          ]}
        ]},
        { "label": "SQL", "steps": [
          { "type": "filter", "conditions": [{ "fieldApiName": "lifecyclestage", "operator": "equals", "value": "salesqualifiedlead" }] },
          { "type": "updateField", "fieldUpdates": [{ "fieldApiName": "hs_lead_status", "fieldValue": "IN_PROGRESS" }] },
          { "type": "assign", "assignmentType": "ROUND_ROBIN", "teamId": "team-ae" }
        ]}
      ]}
    ]
  }]
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

  // Auto-derive searchCriteria from branch conditions for SEARCH rules.
  // searchCriteria tells the engine what to filter at the CRM level (HubSpot Search API / SFDC SOQL).
  // Without it, the engine fetches ALL records and only filters in-memory (very slow for large datasets).
  if (data.triggerEvent === "SEARCH" && !data.searchCriteria && data.branches?.length) {
    // Collect unique conditions across all branches into a single search criteria group
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
