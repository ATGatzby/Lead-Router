import type { AgentContext } from "./contexts";

export interface MutationToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  destructive: boolean;
  contexts: AgentContext[];
}

export const MUTATION_TOOLS: MutationToolDef[] = [
  // === LICENSE TOOLS ===
  {
    name: "license_users",
    description:
      "License one or more Salesforce users so they can receive routed leads. Provide userIds for specific users, OR use byRole/byDepartment to license by criteria. Call with confirm=false (default) to preview which users would be licensed and seat impact. Call with confirm=true to execute.",
    input_schema: {
      type: "object" as const,
      properties: {
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of user IDs to license",
        },
        byRole: {
          type: "string",
          description:
            "License all active unlicensed users with this Salesforce role",
        },
        byDepartment: {
          type: "string",
          description:
            "License all active unlicensed users in this department",
        },
        confirm: {
          type: "boolean",
          description:
            "false = preview only (default), true = execute the licensing",
        },
      },
    },
    destructive: false,
    contexts: ["license-users", "global"],
  },
  {
    name: "delicense_users",
    description:
      "Remove licenses from users. This pauses their round-robin team memberships. Call with confirm=false to preview impact (which teams affected). Call with confirm=true to execute.",
    input_schema: {
      type: "object" as const,
      properties: {
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "Array of user IDs to de-license",
        },
        confirm: {
          type: "boolean",
          description: "false = preview only (default), true = execute",
        },
      },
      required: ["userIds"],
    },
    destructive: true,
    contexts: ["license-users", "global"],
  },

  // === TEAM TOOLS ===
  {
    name: "create_team",
    description:
      "Create a new round-robin team. Optionally add initial members by userIds or by role. Call with confirm=false to preview, confirm=true to create.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Team name" },
        description: {
          type: "string",
          description: "Optional team description",
        },
        distributionType: {
          type: "string",
          enum: ["round-robin", "weighted"],
          description: "Distribution type (default: round-robin)",
        },
        memberUserIds: {
          type: "array",
          items: { type: "string" },
          description: "Optional initial member user IDs",
        },
        membersByRole: {
          type: "string",
          description:
            "Optional: add all licensed active users with this role",
        },
        confirm: {
          type: "boolean",
          description: "false = preview, true = create",
        },
      },
      required: ["name"],
    },
    destructive: false,
    contexts: ["teams", "global"],
  },
  {
    name: "update_team",
    description:
      "Update a team's name, description, or distribution type. Call with confirm=false to preview changes, confirm=true to apply.",
    input_schema: {
      type: "object" as const,
      properties: {
        teamId: { type: "string", description: "Team ID to update" },
        name: { type: "string", description: "New team name" },
        description: {
          type: "string",
          description: "New description (pass null to clear)",
        },
        distributionType: {
          type: "string",
          enum: ["round-robin", "weighted"],
          description: "New distribution type",
        },
        confirm: { type: "boolean" },
      },
      required: ["teamId"],
    },
    destructive: false,
    contexts: ["teams", "global"],
  },
  {
    name: "delete_team",
    description:
      "Delete a round-robin team. Fails if referenced by active routing rules. Preview shows referencing rules.",
    input_schema: {
      type: "object" as const,
      properties: {
        teamId: { type: "string", description: "Team ID to delete" },
        confirm: {
          type: "boolean",
          description: "false = preview (shows impacts), true = delete",
        },
      },
      required: ["teamId"],
    },
    destructive: true,
    contexts: ["teams", "global"],
  },
  {
    name: "manage_team_members",
    description:
      "Add, remove, pause, or activate members in a team. Use userIds for specific users or byRole to match by Salesforce role.",
    input_schema: {
      type: "object" as const,
      properties: {
        teamId: { type: "string", description: "Team ID" },
        action: {
          type: "string",
          enum: ["add", "remove", "pause", "activate"],
          description: "What to do with the members",
        },
        userIds: {
          type: "array",
          items: { type: "string" },
          description: "User IDs to act on",
        },
        byRole: {
          type: "string",
          description: "Alternative: act on all users with this role",
        },
        confirm: { type: "boolean" },
      },
      required: ["teamId", "action"],
    },
    destructive: false,
    contexts: ["teams", "global"],
  },
  {
    name: "update_team_weights",
    description:
      "Set member weights for a weighted distribution team. For percentage mode, weights must sum to 100. For points mode, weights must sum to 10.",
    input_schema: {
      type: "object" as const,
      properties: {
        teamId: { type: "string", description: "Team ID" },
        mode: {
          type: "string",
          enum: ["percentage", "points"],
          description: "Weight mode",
        },
        weights: {
          type: "object",
          description:
            'Map of userId to weight value, e.g. {"user1": 50, "user2": 30, "user3": 20}',
        },
        confirm: { type: "boolean" },
      },
      required: ["teamId", "mode", "weights"],
    },
    destructive: false,
    contexts: ["teams", "global"],
  },

  // === RULE TOOLS ===
  {
    name: "create_rule",
    description:
      "Create a new routing rule with trigger, branches, conditions, and assignment. This is the most complex tool. Always use list_fields first to verify field names. Preview shows full rule structure.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Rule name" },
        objectType: {
          type: "string",
          enum: ["LEAD", "CONTACT", "ACCOUNT"],
          description: "Salesforce object type",
        },
        triggerEvent: {
          type: "string",
          enum: ["INSERT", "UPDATE", "BOTH"],
          description: "When to trigger",
        },
        branches: {
          type: "array",
          description:
            "Routing branches. Each branch has conditions and an assignment.",
          items: {
            type: "object",
            properties: {
              label: {
                type: "string",
                description: "Branch label (e.g. 'Enterprise', 'SMB')",
              },
              priority: {
                type: "number",
                description:
                  "Branch priority (lower = higher priority)",
              },
              assignmentType: {
                type: "string",
                enum: ["USER", "ROUND_ROBIN", "QUEUE"],
              },
              assigneeUserId: {
                type: "string",
                description: "User ID (when assignmentType=USER)",
              },
              assigneeTeamId: {
                type: "string",
                description:
                  "Team ID (when assignmentType=ROUND_ROBIN)",
              },
              assigneeQueueId: {
                type: "string",
                description: "Queue ID (when assignmentType=QUEUE)",
              },
              conditions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    groupId: {
                      type: "string",
                      description:
                        "Conditions in same group are AND-ed; groups are OR-ed",
                    },
                    fieldName: {
                      type: "string",
                      description: "SFDC field API name",
                    },
                    fieldType: {
                      type: "string",
                      description:
                        "TEXT, NUMBER, PICKLIST, BOOLEAN, DATE, DATETIME",
                    },
                    operator: {
                      type: "string",
                      description:
                        "Operator (equals, contains, gt, lt, etc.)",
                    },
                    value: {
                      type: "string",
                      description: "Condition value",
                    },
                  },
                  required: ["groupId", "fieldName", "operator"],
                },
              },
            },
          },
        },
        defaultOwnerType: {
          type: "string",
          enum: ["USER", "ROUND_ROBIN", "QUEUE"],
          description: "Catch-all assignment type",
        },
        defaultOwnerUserId: { type: "string" },
        defaultOwnerTeamId: { type: "string" },
        defaultOwnerQueueId: { type: "string" },
        isDryRun: {
          type: "boolean",
          description:
            "If true, rule logs routing decisions without actually assigning in Salesforce",
        },
        confirm: { type: "boolean" },
      },
      required: ["name", "objectType", "triggerEvent"],
    },
    destructive: false,
    contexts: ["routing-rules", "global"],
  },
  {
    name: "toggle_rule",
    description:
      "Activate or deactivate a routing rule. Preview shows current status and what it will change to.",
    input_schema: {
      type: "object" as const,
      properties: {
        ruleId: { type: "string", description: "Rule ID to toggle" },
        confirm: { type: "boolean" },
      },
      required: ["ruleId"],
    },
    destructive: false,
    contexts: ["routing-rules", "global"],
  },
  {
    name: "delete_rule",
    description:
      "Permanently delete a routing rule and all its branches/conditions. Preview shows rule details and recent routing volume.",
    input_schema: {
      type: "object" as const,
      properties: {
        ruleId: { type: "string", description: "Rule ID to delete" },
        confirm: { type: "boolean" },
      },
      required: ["ruleId"],
    },
    destructive: true,
    contexts: ["routing-rules", "global"],
  },
];
