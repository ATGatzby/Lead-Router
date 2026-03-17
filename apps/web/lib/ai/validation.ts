import { z } from "zod";

// ─── Shared ─────────────────────────────────────────────────────────────────

const conditionSchema = z.object({
  groupId: z.string().min(1, "groupId is required"),
  fieldName: z.string().min(1, "fieldName is required"),
  fieldType: z.string().optional().default("TEXT"),
  operator: z.string().min(1, "operator is required"),
  value: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
});

const conditionGroupSchema = z.object({
  id: z.string().optional(),
  conjunction: z.enum(["AND", "OR"]).optional().default("AND"),
  conditions: z.array(conditionSchema).min(1, "Each condition group must have at least one condition"),
});

// ─── License Users ──────────────────────────────────────────────────────────

export const licenseUsersSchema = z.object({
  confirm: z.boolean().optional().default(false),
  userIds: z.array(z.string().min(1)).optional(),
  byRole: z.string().optional(),
  byDepartment: z.string().optional(),
}).refine(
  (d) => (d.userIds && d.userIds.length > 0) || d.byRole || d.byDepartment,
  { message: "Provide userIds, byRole, or byDepartment to identify which users to license" }
);

export const delicenseUsersSchema = z.object({
  confirm: z.boolean().optional().default(false),
  userIds: z.array(z.string().min(1)).min(1, "userIds must contain at least one user ID"),
});

// ─── Teams ──────────────────────────────────────────────────────────────────

export const createTeamSchema = z.object({
  confirm: z.boolean().optional().default(false),
  name: z.string().min(1, "Team name is required").max(100, "Team name must be under 100 characters"),
  description: z.string().optional(),
  distributionType: z.enum(["round-robin", "weighted"]).optional().default("round-robin"),
  memberUserIds: z.array(z.string().min(1)).optional(),
  membersByRole: z.string().optional(),
});

export const updateTeamSchema = z.object({
  confirm: z.boolean().optional().default(false),
  teamId: z.string().min(1, "teamId is required"),
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  distributionType: z.enum(["round-robin", "weighted"]).optional(),
}).refine(
  (d) => d.name !== undefined || d.description !== undefined || d.distributionType !== undefined,
  { message: "Provide at least one field to update: name, description, or distributionType" }
);

export const deleteTeamSchema = z.object({
  confirm: z.boolean().optional().default(false),
  teamId: z.string().min(1, "teamId is required"),
});

export const manageTeamMembersSchema = z.object({
  confirm: z.boolean().optional().default(false),
  teamId: z.string().min(1, "teamId is required"),
  action: z.enum(["add", "remove", "pause", "activate"], {
    error: "action must be one of: add, remove, pause, activate",
  }),
  userIds: z.array(z.string().min(1)).optional(),
  byRole: z.string().optional(),
}).refine(
  (d) => (d.userIds && d.userIds.length > 0) || d.byRole,
  { message: "Provide userIds or byRole to identify which users to manage" }
);

export const updateTeamWeightsSchema = z.object({
  confirm: z.boolean().optional().default(false),
  teamId: z.string().min(1, "teamId is required"),
  mode: z.enum(["percentage", "points"], {
    error: "mode must be 'percentage' or 'points'",
  }),
  weights: z.record(z.string(), z.number().min(0, "Weight must be non-negative")).refine(
    (w) => Object.keys(w).length > 0,
    { message: "weights must contain at least one userId → weight mapping" }
  ),
});

// ─── Flow Builder ──────────────────────────────────────────────────────────

const flowNodeSchema = z.object({
  type: z.enum(["ENTRY", "DECISION", "BRANCH_DECISION", "MATCH", "ASSIGNMENT", "UPDATE_FIELD", "CREATE_TASK", "FILTER", "DEFAULT"]),
  label: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

const flowEdgeSchema = z.object({
  fromIndex: z.number(),
  toIndex: z.number(),
  label: z.string().optional(),
});

export const createFlowSchema = z.object({
  confirm: z.boolean().optional().default(false),
  objectType: z.enum(["LEAD", "CONTACT", "ACCOUNT"], {
    error: "objectType must be LEAD, CONTACT, or ACCOUNT",
  }),
  name: z.string().optional(),
  triggerEvent: z.enum(["INSERT", "UPDATE", "BOTH"]).optional().default("BOTH"),
  nodes: z.array(flowNodeSchema).optional().default([]),
  edges: z.array(flowEdgeSchema).optional().default([]),
});

export const switchRoutingModeSchema = z.object({
  confirm: z.boolean().optional().default(false),
  objectType: z.enum(["LEAD", "CONTACT", "ACCOUNT"], {
    error: "objectType must be LEAD, CONTACT, or ACCOUNT",
  }),
  mode: z.enum(["CLASSIC", "FLOW"], {
    error: "mode must be CLASSIC or FLOW",
  }),
});

// ─── Routing Rules ──────────────────────────────────────────────────────────

const branchSchema = z.object({
  label: z.string().optional(),
  priority: z.number().optional().default(0),
  assignmentType: z.enum(["USER", "ROUND_ROBIN", "QUEUE"]).optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeTeamId: z.string().nullable().optional(),
  assigneeQueueId: z.string().nullable().optional(),
  conditions: z.array(z.object({
    groupId: z.string().min(1, "groupId is required for each condition"),
    fieldName: z.string().min(1, "fieldName is required — use list_fields tool to find valid field API names"),
    fieldType: z.string().optional().default("TEXT"),
    operator: z.string().min(1, "operator is required (equals, contains, gt, lt, etc.)"),
    value: z.string().nullable().optional(),
    sortOrder: z.number().optional(),
  })).optional().default([]),
}).refine(
  (b) => b.assignmentType || (!b.assigneeUserId && !b.assigneeTeamId && !b.assigneeQueueId),
  { message: "Each branch needs an assignmentType (USER, ROUND_ROBIN, or QUEUE) when assigning to someone" }
);

export const createRuleSchema = z.object({
  confirm: z.boolean().optional().default(false),
  name: z.string().min(1, "Rule name is required").max(200, "Rule name must be under 200 characters"),
  objectType: z.enum(["LEAD", "CONTACT", "ACCOUNT"], {
    error: "objectType must be LEAD, CONTACT, or ACCOUNT",
  }),
  triggerEvent: z.enum(["INSERT", "UPDATE", "BOTH", "SEARCH"], {
    error: "triggerEvent must be INSERT, UPDATE, BOTH, or SEARCH",
  }),
  routeType: z.enum(["REALTIME", "SCHEDULED"]).optional(),
  branches: z.array(branchSchema).optional().default([]),
  // Legacy single-assignee
  assignmentType: z.enum(["USER", "ROUND_ROBIN", "QUEUE"]).optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeTeamId: z.string().nullable().optional(),
  assigneeQueueId: z.string().nullable().optional(),
  // Default owner
  defaultOwnerType: z.enum(["USER", "ROUND_ROBIN", "QUEUE"]).optional(),
  defaultOwnerUserId: z.string().nullable().optional(),
  defaultOwnerTeamId: z.string().nullable().optional(),
  defaultOwnerQueueId: z.string().nullable().optional(),
  // Trigger conditions
  triggerName: z.string().optional().default(""),
  triggerConditions: z.array(conditionSchema).optional().default([]),
  conditions: z.array(conditionSchema).optional().default([]),
  // Match config
  matchConfig: z.any().optional(),
  // Scheduled route fields
  scheduleFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).optional(),
  scheduleTime: z.string().regex(/^\d{2}:\d{2}$/, "scheduleTime must be in HH:MM format").optional(),
  scheduleTimezone: z.string().optional(),
  searchCriteria: z.array(conditionSchema).optional(),
  searchMaxRecords: z.number().optional(),
  searchBatchSize: z.number().optional(),
  isDryRun: z.boolean().optional().default(false),
}).refine(
  (d) => {
    const hasBranches = d.branches && d.branches.length > 0;
    const hasLegacyAssignment = !!d.assignmentType;
    const hasDefaultOwner = !!d.defaultOwnerType;
    // Must have either branches, legacy assignment, or default owner
    return hasBranches || hasLegacyAssignment || hasDefaultOwner;
  },
  { message: "Rule must have at least one branch with an assignment, OR a top-level assignmentType, OR a defaultOwnerType. Use branches for the Route Builder pattern." }
).refine(
  (d) => {
    if (d.triggerEvent === "SEARCH" && !d.scheduleFrequency) {
      return false;
    }
    return true;
  },
  { message: "SEARCH trigger requires scheduleFrequency (DAILY, WEEKLY, or MONTHLY)" }
);

export const toggleRuleSchema = z.object({
  confirm: z.boolean().optional().default(false),
  ruleId: z.string().min(1, "ruleId is required"),
});

export const deleteRuleSchema = z.object({
  confirm: z.boolean().optional().default(false),
  ruleId: z.string().min(1, "ruleId is required"),
});

// ─── Validation runner ──────────────────────────────────────────────────────

const SCHEMAS: Record<string, z.ZodType<any>> = {
  license_users: licenseUsersSchema,
  delicense_users: delicenseUsersSchema,
  create_team: createTeamSchema,
  update_team: updateTeamSchema,
  delete_team: deleteTeamSchema,
  manage_team_members: manageTeamMembersSchema,
  update_team_weights: updateTeamWeightsSchema,
  create_flow: createFlowSchema,
  switch_routing_mode: switchRoutingModeSchema,
  create_rule: createRuleSchema,
  toggle_rule: toggleRuleSchema,
  delete_rule: deleteRuleSchema,
};

/**
 * Validate mutation tool arguments against the expected schema.
 * Returns null if valid, or a structured error object if invalid.
 * The error is designed to be returned as a tool result so the AI can self-correct.
 */
export function validateMutationArgs(
  toolName: string,
  args: Record<string, unknown>,
): { valid: true; data: any } | { valid: false; error: string } {
  const schema = SCHEMAS[toolName];
  if (!schema) return { valid: true, data: args }; // No schema = skip validation

  const result = schema.safeParse(args);
  if (result.success) {
    return { valid: true, data: result.data };
  }

  const issues = result.error.issues.map((i) => {
    const path = i.path.length > 0 ? `${i.path.join(".")}: ` : "";
    return `- ${path}${i.message}`;
  });

  return {
    valid: false,
    error: `VALIDATION ERROR — your tool arguments are invalid. Please fix and retry:\n${issues.join("\n")}\n\nReview the tool description for the correct format and try calling the tool again with corrected arguments.`,
  };
}
