import { z } from "zod";
import { randomUUID } from "crypto";
import type { FieldSchema } from "@/components/condition-builder/types";
import {
  conditionSchema,
  conditionGroupSchema,
  OPERATORS_BY_FIELD_TYPE,
} from "@/lib/ai-trigger-prompt";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Assignee {
  id: string;
  name: string;
  type: "user" | "team" | "queue";
}

// Re-export so route handler can use them
export { conditionSchema, conditionGroupSchema };

// ---------------------------------------------------------------------------
// Zod output schema
// ---------------------------------------------------------------------------

export const aiRouteResponseSchema = z.object({
  enhanced: z.object({
    prompt: z.string(),
    changes: z.array(z.string()),
  }),
  route: z.object({
    name: z.string(),
    routeType: z.enum(["REALTIME", "SCHEDULED"]).optional(),
    trigger: z.object({
      objectType: z.enum(["LEAD", "CONTACT", "ACCOUNT"]),
      triggerEvent: z.enum(["INSERT", "UPDATE", "BOTH"]),
      conditions: z.array(conditionGroupSchema),
    }).optional(),
    searchTrigger: z.object({
      objectType: z.enum(["LEAD", "CONTACT", "ACCOUNT"]),
      searchCriteria: z.array(conditionGroupSchema),
      frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
      scheduleTime: z.string().optional(),
      scheduleTimezone: z.string().optional(),
    }).optional(),
    matchConfig: z
      .object({
        enabled: z.boolean(),
        matchFields: z.array(
          z.enum(["email", "phone", "domain", "companyName"]),
        ),
        fuzzyMode: z.enum(["STRICT", "FUZZY", "AI_SMART"]).optional(),
      })
      .optional(),
    paths: z.array(
      z.object({
        label: z.string(),
        conditions: z.array(conditionGroupSchema),
        assignmentType: z.enum(["USER", "ROUND_ROBIN", "QUEUE"]),
        assigneeName: z.string(),
      }),
    ),
    defaultOwner: z
      .object({
        assignmentType: z.enum(["USER", "ROUND_ROBIN", "QUEUE"]),
        assigneeName: z.string(),
      })
      .optional(),
  }),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()).optional(),
});

export type AIRouteResponse = z.infer<typeof aiRouteResponseSchema>;

// ---------------------------------------------------------------------------
// RouteBuilderState types (mirrors the UI state)
// ---------------------------------------------------------------------------

interface ConditionState {
  id: string;
  groupId: string;
  fieldApiName: string;
  fieldType:
    | "TEXT"
    | "NUMBER"
    | "DATE"
    | "DATETIME"
    | "BOOLEAN"
    | "PICKLIST"
    | "MULTI_PICKLIST"
    | "LOOKUP";
  operator: string;
  value: string;
}

interface ConditionGroupState {
  id: string;
  conjunction: "AND" | "OR";
  conditions: ConditionState[];
}

interface TriggerConfig {
  triggerName: string;
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  triggerEvent: "INSERT" | "UPDATE" | "BOTH";
  isDryRun: boolean;
  triggerConditions: ConditionGroupState[];
}

interface CustomAssignment {
  assignmentType: "USER" | "ROUND_ROBIN" | "QUEUE";
  assigneeId: string;
  assigneeName: string;
}

interface MatchConfig {
  checkLeads: boolean;
  checkContacts: boolean;
  checkAccounts: boolean;
  matchEmail: boolean;
  matchPhone: boolean;
  matchDomain: boolean;
  matchCompanyName: boolean;
  fuzzyMatchMode: "STRICT" | "FUZZY" | "AI_SMART";
  onLeadMatch: "SFDC_MERGE" | "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM";
  leadCustomAssignment: CustomAssignment | null;
  onContactMatch: "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP";
  contactCustomAssignment: CustomAssignment | null;
  onAccountMatch: "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP";
  accountCustomAssignment: CustomAssignment | null;
}

interface PathAction {
  assignmentType: "USER" | "ROUND_ROBIN" | "QUEUE" | null;
  assigneeId: string | null;
  assigneeName: string | null;
}

interface RoutePath {
  id: string;
  label: string;
  conditions: ConditionGroupState[];
  action: PathAction;
}

interface DefaultOwner {
  assignmentType: "USER" | "ROUND_ROBIN" | "QUEUE";
  assigneeId: string;
  assigneeName: string;
}

interface SearchTriggerConfig {
  triggerName: string;
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  searchCriteria: ConditionGroupState[];
  frequency: "DAILY" | "WEEKLY" | "MONTHLY";
  scheduleTime: string;
  scheduleTimezone: string;
  batchSize: number;
  searchMaxRecords: number | null;
  skipRecentlyRouted: boolean;
  isDryRun: boolean;
}

export interface RouteBuilderState {
  name: string;
  routeType: "REALTIME" | "SCHEDULED";
  trigger: TriggerConfig | null;
  searchTrigger: SearchTriggerConfig | null;
  matchConfig: MatchConfig | null;
  paths: RoutePath[];
  defaultOwner: DefaultOwner | null;
}

// ---------------------------------------------------------------------------
// Few-shot examples
// ---------------------------------------------------------------------------

const FEW_SHOT_ROUTE_EXAMPLES: {
  input: string;
  output: AIRouteResponse;
}[] = [
  {
    input: "Route web leads to sales team",
    output: {
      enhanced: {
        prompt:
          "Route leads where LeadSource equals 'Web' on insert, assign to Sales Team via round robin",
        changes: [
          "Mapped 'web leads' to LeadSource = 'Web'",
          "Defaulted trigger event to INSERT",
          "Mapped 'sales team' to round robin assignment",
        ],
      },
      route: {
        name: "Web Leads to Sales",
        trigger: {
          objectType: "LEAD",
          triggerEvent: "INSERT",
          conditions: [
            {
              conjunction: "AND",
              conditions: [
                {
                  fieldApiName: "LeadSource",
                  fieldType: "PICKLIST",
                  operator: "equals",
                  value: "Web",
                },
              ],
            },
          ],
        },
        paths: [
          {
            label: "Web Leads",
            conditions: [
              {
                conjunction: "AND",
                conditions: [
                  {
                    fieldApiName: "LeadSource",
                    fieldType: "PICKLIST",
                    operator: "equals",
                    value: "Web",
                  },
                ],
              },
            ],
            assignmentType: "ROUND_ROBIN",
            assigneeName: "Sales Team",
          },
        ],
      },
      confidence: 0.9,
      warnings: [],
    },
  },
  {
    input:
      "Route leads, match by email, assign to existing owner if found",
    output: {
      enhanced: {
        prompt:
          "Route all leads on insert with email matching enabled, assign to existing record owner when a match is found",
        changes: [
          "Added match config with email matching",
          "Set match behavior to assign to existing owner",
          "No trigger conditions (all leads)",
        ],
      },
      route: {
        name: "Lead Matching by Email",
        trigger: {
          objectType: "LEAD",
          triggerEvent: "INSERT",
          conditions: [],
        },
        matchConfig: {
          enabled: true,
          matchFields: ["email"],
          fuzzyMode: "STRICT",
        },
        paths: [
          {
            label: "All Leads",
            conditions: [],
            assignmentType: "ROUND_ROBIN",
            assigneeName: "Default Team",
          },
        ],
      },
      confidence: 0.8,
      warnings: [
        "No specific team name provided for unmatched leads. Using 'Default Team' as placeholder.",
      ],
    },
  },
  {
    input:
      "Enterprise leads to enterprise team, SMB leads to SMB team, everything else to general sales",
    output: {
      enhanced: {
        prompt:
          "Route leads on insert: if NumberOfEmployees > 500 assign to Enterprise Team, if NumberOfEmployees <= 500 assign to SMB Team, default to General Sales queue",
        changes: [
          "Mapped 'enterprise' to NumberOfEmployees > 500",
          "Mapped 'SMB' to NumberOfEmployees <= 500",
          "Mapped 'everything else' to default owner",
          "Created two routing paths with size-based conditions",
        ],
      },
      route: {
        name: "Enterprise vs SMB Routing",
        trigger: {
          objectType: "LEAD",
          triggerEvent: "INSERT",
          conditions: [],
        },
        paths: [
          {
            label: "Enterprise",
            conditions: [
              {
                conjunction: "AND",
                conditions: [
                  {
                    fieldApiName: "NumberOfEmployees",
                    fieldType: "NUMBER",
                    operator: "gt",
                    value: "500",
                  },
                ],
              },
            ],
            assignmentType: "ROUND_ROBIN",
            assigneeName: "Enterprise Team",
          },
          {
            label: "SMB",
            conditions: [
              {
                conjunction: "AND",
                conditions: [
                  {
                    fieldApiName: "NumberOfEmployees",
                    fieldType: "NUMBER",
                    operator: "lte",
                    value: "500",
                  },
                ],
              },
            ],
            assignmentType: "ROUND_ROBIN",
            assigneeName: "SMB Team",
          },
        ],
        defaultOwner: {
          assignmentType: "QUEUE",
          assigneeName: "General Sales",
        },
      },
      confidence: 0.7,
      warnings: [
        "Interpreted 'enterprise' as NumberOfEmployees > 500. Adjust the threshold if needed.",
        "Interpreted 'SMB' as NumberOfEmployees <= 500.",
      ],
    },
  },
  {
    input:
      "When contacts are created from trade shows, match by email and domain, assign to event team, default to marketing queue",
    output: {
      enhanced: {
        prompt:
          "Route contacts where LeadSource equals 'Trade Show' on insert, match by email and domain, assign to Event Team, default to Marketing Queue",
        changes: [
          "Detected 'contacts' as CONTACT object type",
          "Mapped 'trade shows' to LeadSource = 'Trade Show'",
          "Added match config with email and domain matching",
          "Mapped 'event team' to round robin assignment",
          "Mapped 'marketing queue' to queue default owner",
        ],
      },
      route: {
        name: "Trade Show Contact Routing",
        trigger: {
          objectType: "CONTACT",
          triggerEvent: "INSERT",
          conditions: [
            {
              conjunction: "AND",
              conditions: [
                {
                  fieldApiName: "LeadSource",
                  fieldType: "PICKLIST",
                  operator: "equals",
                  value: "Trade Show",
                },
              ],
            },
          ],
        },
        matchConfig: {
          enabled: true,
          matchFields: ["email", "domain"],
          fuzzyMode: "STRICT",
        },
        paths: [
          {
            label: "Trade Show Contacts",
            conditions: [
              {
                conjunction: "AND",
                conditions: [
                  {
                    fieldApiName: "LeadSource",
                    fieldType: "PICKLIST",
                    operator: "equals",
                    value: "Trade Show",
                  },
                ],
              },
            ],
            assignmentType: "ROUND_ROBIN",
            assigneeName: "Event Team",
          },
        ],
        defaultOwner: {
          assignmentType: "QUEUE",
          assigneeName: "Marketing Queue",
        },
      },
      confidence: 0.9,
      warnings: [],
    },
  },
  {
    input:
      "Route hot leads from paid campaigns to Sarah Connor, warm leads to sales team round robin",
    output: {
      enhanced: {
        prompt:
          "Route leads on insert: if Rating = 'Hot' AND LeadSource = 'Paid' assign to Sarah Connor, if Rating = 'Warm' assign to Sales Team round robin",
        changes: [
          "Mapped 'hot leads' to Rating = 'Hot'",
          "Mapped 'paid campaigns' to LeadSource = 'Paid'",
          "Mapped 'Sarah Connor' to direct user assignment",
          "Mapped 'warm leads' to Rating = 'Warm'",
          "Mapped 'sales team round robin' to round robin assignment",
        ],
      },
      route: {
        name: "Hot & Warm Lead Routing",
        trigger: {
          objectType: "LEAD",
          triggerEvent: "INSERT",
          conditions: [],
        },
        paths: [
          {
            label: "Hot Paid Leads",
            conditions: [
              {
                conjunction: "AND",
                conditions: [
                  {
                    fieldApiName: "Rating",
                    fieldType: "PICKLIST",
                    operator: "equals",
                    value: "Hot",
                  },
                  {
                    fieldApiName: "LeadSource",
                    fieldType: "PICKLIST",
                    operator: "equals",
                    value: "Paid",
                  },
                ],
              },
            ],
            assignmentType: "USER",
            assigneeName: "Sarah Connor",
          },
          {
            label: "Warm Leads",
            conditions: [
              {
                conjunction: "AND",
                conditions: [
                  {
                    fieldApiName: "Rating",
                    fieldType: "PICKLIST",
                    operator: "equals",
                    value: "Warm",
                  },
                ],
              },
            ],
            assignmentType: "ROUND_ROBIN",
            assigneeName: "Sales Team",
          },
        ],
      },
      confidence: 0.85,
      warnings: [],
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

export function buildRouteSystemPrompt(
  fields: Record<string, FieldSchema[]>,
  users: Assignee[],
  teams: Assignee[],
  queues: Assignee[],
): string {
  // Build field list grouped by object type
  const fieldSections = Object.entries(fields)
    .map(([objectType, fieldList]) => {
      const lines = fieldList
        .map((f) => {
          let desc = `  - ${f.fieldApiName} (${f.fieldLabel}): type=${f.fieldType}`;
          if (f.picklistValues && f.picklistValues.length > 0) {
            desc += `, values=[${f.picklistValues.map((v) => `"${v}"`).join(", ")}]`;
          }
          return desc;
        })
        .join("\n");
      return `### ${objectType}\n${lines}`;
    })
    .join("\n\n");

  const operatorList = Object.entries(OPERATORS_BY_FIELD_TYPE)
    .map(([type, ops]) => `- ${type}: ${ops.join(", ")}`)
    .join("\n");

  const userList =
    users.length > 0
      ? users.map((u) => `  - "${u.name}" (user)`).join("\n")
      : "  (none synced)";
  const teamList =
    teams.length > 0
      ? teams.map((t) => `  - "${t.name}" (round robin team)`).join("\n")
      : "  (none configured)";
  const queueList =
    queues.length > 0
      ? queues.map((q) => `  - "${q.name}" (queue)`).join("\n")
      : "  (none synced)";

  const examplesText = FEW_SHOT_ROUTE_EXAMPLES.map(
    (ex, i) =>
      `Example ${i + 1}:\nUser: "${ex.input}"\nAssistant: ${JSON.stringify(ex.output, null, 2)}`,
  ).join("\n\n");

  return `You are an AI assistant that converts natural language descriptions into complete routing rule configurations for a lead routing system.

## Task
Given a user's description of a routing workflow, produce a JSON object that defines:
1. A route name
2. A trigger configuration (object type, event, and optional entry conditions)
3. Optional match/dedup configuration (when the user mentions matching, deduplication, finding existing records)
4. One or more routing paths with conditions and assignments
5. An optional default owner for unmatched records
6. An enhanced version of the user's prompt
7. A confidence score and any warnings

## Available Fields (by Object Type)
${fieldSections}

## Valid Operators by Field Type
${operatorList}

## Available Assignees
### Users (assignmentType: "USER")
${userList}

### Round Robin Teams (assignmentType: "ROUND_ROBIN")
${teamList}

### Queues (assignmentType: "QUEUE")
${queueList}

## Output Format
Return ONLY a JSON object matching this exact structure (no markdown, no code fences).
Use EITHER "trigger" (for REALTIME) OR "searchTrigger" (for SCHEDULED), never both:
{
  "enhanced": {
    "prompt": "A rewritten version using exact field API names and assignee names",
    "changes": ["List of changes made"]
  },
  "route": {
    "name": "Short descriptive route name",
    "routeType": "REALTIME" | "SCHEDULED",
    "trigger": {
      "objectType": "LEAD" | "CONTACT" | "ACCOUNT",
      "triggerEvent": "INSERT" | "UPDATE" | "BOTH",
      "conditions": [/* condition groups */]
    },
    "searchTrigger": {
      "objectType": "LEAD" | "CONTACT" | "ACCOUNT",
      "searchCriteria": [/* condition groups — same format as trigger conditions */],
      "frequency": "DAILY" | "WEEKLY" | "MONTHLY",
      "scheduleTime": "06:00",
      "scheduleTimezone": "UTC"
    },
    "matchConfig": {
      "enabled": true,
      "matchFields": ["email", "phone", "domain", "companyName"],
      "fuzzyMode": "STRICT" | "FUZZY" | "AI_SMART"
    },
    "paths": [
      {
        "label": "Human-readable path name",
        "conditions": [/* same condition group structure */],
        "assignmentType": "USER" | "ROUND_ROBIN" | "QUEUE",
        "assigneeName": "exact name from Available Assignees"
      }
    ],
    "defaultOwner": {
      "assignmentType": "USER" | "ROUND_ROBIN" | "QUEUE",
      "assigneeName": "exact name"
    }
  },
  "confidence": 0.0 to 1.0,
  "warnings": ["optional warnings"]
}

## Assignment Rules
- If the user names a specific person, use assignmentType "USER" and match to the closest user name
- If the user mentions "team", "round robin", or "rotate", use assignmentType "ROUND_ROBIN" and match to the closest team name
- If the user mentions "queue", use assignmentType "QUEUE" and match to the closest queue name
- If the assignee name doesn't match any known name, still include it and add a warning
- Always try to match the user's assignee reference to the Available Assignees list above

## Match Config Rules
- Only include matchConfig when the user explicitly mentions matching, deduplication, finding existing records, or checking for duplicates
- "match by email" -> matchFields: ["email"]
- "match by email and domain" -> matchFields: ["email", "domain"]
- "deduplicate" or "find existing" -> enabled: true with reasonable defaults (email matching)
- "assign to existing owner" implies match config with ASSIGN_TO_OWNER behavior
- Default fuzzyMode to "STRICT" unless the user mentions "fuzzy" or "smart" matching

## Trigger Conditions vs Path Conditions
- Trigger conditions are entry-level filters: they determine which records even enter the route
- Path conditions determine which specific path a record follows within the route
- If the user describes one broad filter and then specific routing paths, put the broad filter in trigger conditions and the specific criteria in path conditions
- If the user only describes routing paths without a broad filter, leave trigger conditions empty

## Prompt Enhancement Rules
- Rewrite the user's vague description into a precise statement using exact field API names and assignee names
- In "changes", list every interpretation or assumption you made
- Map concepts to the closest available fields

## Confidence Scoring
- 1.0: Every field and assignee maps exactly to available options
- 0.8-0.9: All fields found, assignees mostly matched, minor inferences
- 0.6-0.7: Some fields or assignees inferred from context
- 0.4-0.5: Significant guessing required
- Below 0.4: Too ambiguous

## Warning Guidelines
- Add a warning when an assignee name doesn't match any known user/team/queue
- Add a warning when a field or picklist value is not found
- Add a warning when significant assumptions are made about the routing logic

## Route Type: REALTIME vs SCHEDULED (Search)
IMPORTANT: Determine if the user wants a real-time trigger or a scheduled search:
- **REALTIME** (default): Fires when a record is created/updated in Salesforce. Use when user says: "when created", "on insert", "new leads", "when updated", "incoming leads"
- **SCHEDULED (Search)**: Searches existing records in Salesforce on a schedule. Use when user says: "search all leads", "find all", "query my CRM", "look for existing", "search Salesforce", "bulk route", "all leads in my CRM", "scan for"

When SCHEDULED, use "searchTrigger" instead of "trigger" in the output:
- Set "routeType": "SCHEDULED"
- Use "searchTrigger" with "searchCriteria" (same condition format), "frequency" (DAILY/WEEKLY/MONTHLY), "scheduleTime" ("06:00"), "scheduleTimezone" ("UTC")
- Do NOT include "trigger" when using "searchTrigger"

When REALTIME (default):
- Set "routeType": "REALTIME"
- Use "trigger" with "triggerEvent" and "conditions"
- Do NOT include "searchTrigger"

## Default Behaviors
- If no object type is mentioned, default to LEAD
- If no trigger event is mentioned and route is REALTIME, default to INSERT
- If route is SCHEDULED and no frequency mentioned, default to DAILY at 06:00 UTC
- Use AND conjunction within a group unless the user explicitly says "or" about DIFFERENT fields
- IMPORTANT: When multiple values are listed for the SAME field, use "includes" with comma-separated values
- "&", "and", "+", "also" all mean AND within the SAME condition group

## Examples
${examplesText}

Now convert the user's prompt into the JSON structure described above.`;
}

// ---------------------------------------------------------------------------
// Response validator
// ---------------------------------------------------------------------------

export function validateRouteResponse(
  response: unknown,
  fields: Record<string, FieldSchema[]>,
  users: Assignee[],
  teams: Assignee[],
  queues: Assignee[],
): AIRouteResponse {
  // Step 1: Parse with Zod
  const parsed = aiRouteResponseSchema.parse(response);

  // Build lookup maps for fields (all object types combined)
  const allFields = new Map<string, FieldSchema>();
  for (const fieldList of Object.values(fields)) {
    for (const f of fieldList) {
      allFields.set(f.fieldApiName.toLowerCase(), f);
    }
  }

  // Build assignee lookup
  const allAssignees: Assignee[] = [...users, ...teams, ...queues];

  const warnings: string[] = [...(parsed.warnings ?? [])];

  // Step 2: Validate trigger conditions (real-time or search)
  if (parsed.route.trigger) {
    validateConditionGroups(
      parsed.route.trigger.conditions,
      allFields,
      warnings,
    );
  }
  if (parsed.route.searchTrigger) {
    validateConditionGroups(
      parsed.route.searchTrigger.searchCriteria,
      allFields,
      warnings,
    );
  }

  // Step 3: Validate path conditions and assignees
  for (const path of parsed.route.paths) {
    validateConditionGroups(path.conditions, allFields, warnings);

    // Validate assignee
    const resolved = resolveAssignee(
      path.assigneeName,
      path.assignmentType,
      allAssignees,
    );
    if (!resolved) {
      warnings.push(
        `Assignee "${path.assigneeName}" (${path.assignmentType}) was not found in the available assignees list. You may need to update this after saving.`,
      );
    }
  }

  // Step 4: Validate default owner assignee
  if (parsed.route.defaultOwner) {
    const resolved = resolveAssignee(
      parsed.route.defaultOwner.assigneeName,
      parsed.route.defaultOwner.assignmentType,
      allAssignees,
    );
    if (!resolved) {
      warnings.push(
        `Default owner "${parsed.route.defaultOwner.assigneeName}" (${parsed.route.defaultOwner.assignmentType}) was not found in the available assignees list.`,
      );
    }
  }

  return {
    ...parsed,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function validateConditionGroups(
  groups: z.infer<typeof conditionGroupSchema>[],
  allFields: Map<string, FieldSchema>,
  warnings: string[],
): void {
  for (const group of groups) {
    for (const condition of group.conditions) {
      const key = condition.fieldApiName.toLowerCase();
      const field = allFields.get(key);

      if (!field) {
        const isRelationship = condition.fieldApiName.includes(".");
        if (isRelationship) {
          warnings.push(
            `Relationship field "${condition.fieldApiName}" cannot be validated. Ensure it exists in your Salesforce org.`,
          );
        } else {
          warnings.push(
            `Field "${condition.fieldApiName}" was not found in the available fields.`,
          );
        }
        continue;
      }

      // Validate field type
      if (field.fieldType !== condition.fieldType) {
        warnings.push(
          `Field "${condition.fieldApiName}" has type ${field.fieldType} but condition uses ${condition.fieldType}. Correcting.`,
        );
        condition.fieldType = field.fieldType as any;
      }

      // Validate operator
      const validOps = OPERATORS_BY_FIELD_TYPE[condition.fieldType];
      if (validOps && !validOps.includes(condition.operator)) {
        warnings.push(
          `Operator "${condition.operator}" is not valid for field type ${condition.fieldType} on "${condition.fieldApiName}". Valid: ${validOps.join(", ")}.`,
        );
      }

      // Validate picklist values
      if (
        (field.fieldType === "PICKLIST" ||
          field.fieldType === "MULTI_PICKLIST") &&
        field.picklistValues &&
        field.picklistValues.length > 0
      ) {
        const val = condition.value;
        if (
          condition.operator !== "is_blank" &&
          condition.operator !== "is_not_blank"
        ) {
          // Handle comma-separated values for includes/excludes
          const values = val.split(",").map((v) => v.trim());
          const corrected: string[] = [];
          for (const v of values) {
            if (!field.picklistValues.includes(v)) {
              const match = field.picklistValues.find(
                (pv) => pv.toLowerCase() === v.toLowerCase(),
              );
              if (match) {
                warnings.push(
                  `Picklist value "${v}" on "${condition.fieldApiName}" corrected to "${match}".`,
                );
                corrected.push(match);
              } else {
                warnings.push(
                  `Picklist value "${v}" not in known values for "${condition.fieldApiName}": [${field.picklistValues.join(", ")}].`,
                );
                corrected.push(v);
              }
            } else {
              corrected.push(v);
            }
          }
          condition.value = corrected.join(",");
        }
      }

      // Fix casing
      if (field.fieldApiName !== condition.fieldApiName) {
        condition.fieldApiName = field.fieldApiName;
      }
    }
  }
}

function resolveAssignee(
  name: string,
  type: "USER" | "ROUND_ROBIN" | "QUEUE",
  assignees: Assignee[],
): Assignee | null {
  const nameLower = name.toLowerCase();

  // Filter by type
  const typeMap: Record<string, Assignee["type"]> = {
    USER: "user",
    ROUND_ROBIN: "team",
    QUEUE: "queue",
  };
  const targetType = typeMap[type];

  // Exact match first
  const exact = assignees.find(
    (a) => a.type === targetType && a.name.toLowerCase() === nameLower,
  );
  if (exact) return exact;

  // Contains match
  const contains = assignees.find(
    (a) =>
      a.type === targetType &&
      (a.name.toLowerCase().includes(nameLower) ||
        nameLower.includes(a.name.toLowerCase())),
  );
  if (contains) return contains;

  // Try any type as fallback
  const anyType = assignees.find(
    (a) => a.name.toLowerCase() === nameLower,
  );
  return anyType ?? null;
}

// ---------------------------------------------------------------------------
// Map AI response to RouteBuilderState
// ---------------------------------------------------------------------------

export function mapRouteResponseToBuilderState(
  validated: AIRouteResponse,
  users: Assignee[],
  teams: Assignee[],
  queues: Assignee[],
): RouteBuilderState {
  const allAssignees: Assignee[] = [...users, ...teams, ...queues];

  // --- Trigger (only for REALTIME) ---
  let trigger: TriggerConfig | null = null;
  if (validated.route.trigger) {
    const triggerConditions = validated.route.trigger.conditions.map(
      (group) => {
        const groupId = randomUUID();
        return {
          id: groupId,
          conjunction: group.conjunction,
          conditions: group.conditions.map((c) => ({
            id: randomUUID(),
            groupId,
            fieldApiName: c.fieldApiName,
            fieldType: c.fieldType as ConditionState["fieldType"],
            operator: c.operator,
            value: c.value,
          })),
        };
      },
    );

    trigger = {
      triggerName: validated.route.name,
      objectType: validated.route.trigger.objectType,
      triggerEvent: validated.route.trigger.triggerEvent,
      isDryRun: false,
      triggerConditions,
    };
  }

  // --- Match config ---
  let matchConfig: MatchConfig | null = null;
  if (validated.route.matchConfig?.enabled) {
    const mc = validated.route.matchConfig;
    matchConfig = {
      checkLeads: true,
      checkContacts: true,
      checkAccounts: true,
      matchEmail: mc.matchFields.includes("email"),
      matchPhone: mc.matchFields.includes("phone"),
      matchDomain: mc.matchFields.includes("domain"),
      matchCompanyName: mc.matchFields.includes("companyName"),
      fuzzyMatchMode: mc.fuzzyMode ?? "STRICT",
      onLeadMatch: "ASSIGN_TO_OWNER",
      leadCustomAssignment: null,
      onContactMatch: "ASSIGN_TO_OWNER",
      contactCustomAssignment: null,
      onAccountMatch: "ASSIGN_TO_OWNER",
      accountCustomAssignment: null,
    };
  }

  // --- Paths ---
  const paths: RoutePath[] = validated.route.paths.map((p) => {
    const resolved = resolveAssignee(
      p.assigneeName,
      p.assignmentType,
      allAssignees,
    );

    const pathConditions = p.conditions.map((group) => {
      const groupId = randomUUID();
      return {
        id: groupId,
        conjunction: group.conjunction,
        conditions: group.conditions.map((c) => ({
          id: randomUUID(),
          groupId,
          fieldApiName: c.fieldApiName,
          fieldType: c.fieldType as ConditionState["fieldType"],
          operator: c.operator,
          value: c.value,
        })),
      };
    });

    return {
      id: randomUUID(),
      label: p.label,
      conditions: pathConditions,
      action: {
        assignmentType: p.assignmentType,
        assigneeId: resolved?.id ?? null,
        assigneeName: resolved?.name ?? p.assigneeName,
      },
    };
  });

  // --- Default owner ---
  let defaultOwner: DefaultOwner | null = null;
  if (validated.route.defaultOwner) {
    const d = validated.route.defaultOwner;
    const resolved = resolveAssignee(
      d.assigneeName,
      d.assignmentType,
      allAssignees,
    );
    defaultOwner = {
      assignmentType: d.assignmentType,
      assigneeId: resolved?.id ?? "",
      assigneeName: resolved?.name ?? d.assigneeName,
    };
  }

  // --- Search trigger (if scheduled) ---
  const isScheduled = validated.route.routeType === "SCHEDULED" || !!validated.route.searchTrigger;
  let searchTrigger = null;
  if (isScheduled && validated.route.searchTrigger) {
    const st = validated.route.searchTrigger;
    const searchCriteria: ConditionGroupState[] = (st.searchCriteria ?? []).map(
      (group) => {
        const groupId = randomUUID();
        return {
          id: groupId,
          conjunction: group.conjunction,
          conditions: group.conditions.map((c) => ({
            id: randomUUID(),
            groupId,
            fieldApiName: c.fieldApiName,
            fieldType: c.fieldType as ConditionState["fieldType"],
            operator: c.operator,
            value: c.value,
          })),
        };
      },
    );
    searchTrigger = {
      triggerName: validated.route.name,
      objectType: st.objectType,
      searchCriteria,
      frequency: (st.frequency as "DAILY" | "WEEKLY" | "MONTHLY") ?? "DAILY",
      scheduleTime: st.scheduleTime ?? "06:00",
      scheduleTimezone: st.scheduleTimezone ?? "UTC",
      batchSize: 500,
      searchMaxRecords: null,
      skipRecentlyRouted: true,
      isDryRun: false,
    };
  }

  return {
    name: validated.route.name,
    routeType: isScheduled ? "SCHEDULED" as const : "REALTIME" as const,
    trigger: isScheduled ? null : trigger,
    searchTrigger,
    matchConfig,
    paths,
    defaultOwner,
  };
}
