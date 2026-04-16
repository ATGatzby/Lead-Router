import { z } from "zod";

export type ZodSchema = z.ZodSchema<any>;

/**
 * Validate tool input against a Zod schema before calling the API.
 * Throws a descriptive error if validation fails, preventing bad payloads from reaching the server.
 */
export function validateInput<T>(schema: z.ZodSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid input:\n${issues}`);
  }
  return result.data;
}

// ── Shared enums ────────────────────────────────────────────────────────────

export const ObjectTypeEnum = z.enum(["LEAD", "CONTACT", "ACCOUNT", "COMPANY", "DEAL"]);
export const EventTypeEnum = z.enum(["INSERT", "UPDATE", "BOTH", "SEARCH"]);
export const AssignmentTypeEnum = z.enum(["USER", "ROUND_ROBIN", "QUEUE"]);
export const DistributionTypeEnum = z.enum(["round-robin", "weighted"]);
export const MemberStatusEnum = z.enum(["ACTIVE", "PAUSED"]);
export const RoutingModeEnum = z.enum(["rules", "flows"]);

// ── Tool input schemas ─────────────────────────────────────────────────────

// Rules
export const ListRulesInput = z.object({
  objectType: ObjectTypeEnum.optional(),
}).strict().optional();

export const GetRuleInput = z.object({
  ruleId: z.string().min(1, "ruleId is required"),
}).strict();

export const CreateRuleInput = z.object({
  name: z.string().min(1, "name is required"),
  objectType: ObjectTypeEnum,
  triggerEvent: z.enum(["INSERT", "UPDATE", "BOTH", "SEARCH"]),
  conditions: z.array(z.object({
    groupId: z.string().optional(),
    fieldName: z.string(),
    fieldType: z.string().optional(),
    operator: z.string(),
    value: z.union([z.string(), z.null()]).optional(),
    sortOrder: z.number().optional(),
  })).optional(),
  branches: z.array(z.object({
    label: z.string().optional(),
    priority: z.number().optional(),
    assignmentType: AssignmentTypeEnum,
    assigneeUserId: z.string().optional().nullable(),
    assigneeTeamId: z.string().optional().nullable(),
    assigneeQueueId: z.string().optional().nullable(),
    steps: z.any().optional(),
    conditions: z.array(z.object({
      groupId: z.string().optional(),
      fieldName: z.string(),
      fieldType: z.string().optional(),
      operator: z.string(),
      value: z.union([z.string(), z.null()]).optional(),
      sortOrder: z.number().optional(),
    })).optional(),
  })).optional(),
  routeType: z.enum(["STANDARD", "SEARCH", "SCHEDULED"]).optional(),
  searchCriteria: z.any().optional(),
  searchMaxRecords: z.number().optional(),
  searchBatchSize: z.number().optional(),
  scheduleFrequency: z.string().optional(),
  scheduleTime: z.string().optional(),
  scheduleTimezone: z.string().optional(),
  scheduleCron: z.string().optional(),
  matchConfig: z.any().optional(),
  defaultOwner: z.string().optional(),
  isDryRun: z.boolean().optional(),
  confirm: z.boolean().optional(),
  tree: z.array(z.any()).optional(),
}).strict();

export const UpdateRuleInput = z.object({
  ruleId: z.string().min(1, "ruleId is required"),
  name: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  priority: z.number().int().positive().optional(),
  triggerEvent: z.enum(["INSERT", "UPDATE", "BOTH", "SEARCH"]).optional(),
  conditions: z.array(z.any()).optional(),
  branches: z.array(z.any()).optional(),
  tree: z.array(z.any()).optional(),
  scheduleFrequency: z.string().optional(),
  isDryRun: z.boolean().optional(),
  matchConfig: z.any().optional(),
  confirm: z.boolean().optional(),
});

export const DeleteRuleInput = z.object({
  ruleId: z.string().min(1, "ruleId is required"),
  confirm: z.boolean().optional(),
}).strict();

export const CloneRuleInput = z.object({
  ruleId: z.string().min(1, "ruleId is required"),
  newName: z.string().optional(),
  confirm: z.boolean().optional(),
}).strict();

export const ReorderRulesInput = z.object({
  ruleIds: z.array(z.string().min(1)).min(1, "At least one ruleId required"),
  confirm: z.boolean().optional(),
}).strict();

export const TestRuleInput = z.object({
  ruleId: z.string().min(1, "ruleId is required"),
  fields: z.record(z.string(), z.unknown()),
}).strict();

export const RunScheduledRuleInput = z.object({
  ruleId: z.string().min(1, "ruleId is required"),
  confirm: z.boolean().optional(),
}).strict();

// Teams
export const CreateTeamInput = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  distributionType: DistributionTypeEnum.optional(),
  confirm: z.boolean().optional(),
}).strict();

export const UpdateTeamInput = z.object({
  teamId: z.string().min(1, "teamId is required"),
  name: z.string().optional(),
  description: z.string().optional(),
  distributionType: DistributionTypeEnum.optional(),
  confirm: z.boolean().optional(),
});

export const DeleteTeamInput = z.object({
  teamId: z.string().min(1, "teamId is required"),
  confirm: z.boolean().optional(),
}).strict();

export const AddTeamMemberInput = z.object({
  teamId: z.string().min(1, "teamId is required"),
  userId: z.string().min(1, "userId is required"),
  weight: z.number().int().nonnegative().optional(),
  confirm: z.boolean().optional(),
}).strict();

export const RemoveTeamMemberInput = z.object({
  teamId: z.string().min(1, "teamId is required"),
  userId: z.string().min(1, "userId is required"),
  confirm: z.boolean().optional(),
}).strict();

export const ToggleTeamMemberInput = z.object({
  teamId: z.string().min(1, "teamId is required"),
  userId: z.string().min(1, "userId is required"),
  status: MemberStatusEnum,
  confirm: z.boolean().optional(),
}).strict();

export const UpdateTeamWeightsInput = z.object({
  teamId: z.string().min(1, "teamId is required"),
  weights: z.array(z.object({
    userId: z.string().min(1),
    weight: z.number().int().nonnegative(),
  })).min(1, "At least one weight entry required"),
  confirm: z.boolean().optional(),
}).strict();

export const ResetTeamPointerInput = z.object({
  teamId: z.string().min(1, "teamId is required"),
  confirm: z.boolean().optional(),
}).strict();

// Users
export const ListUsersInput = z.object({
  query: z.string().optional(),
  licensed: z.union([z.boolean(), z.string()]).optional(),
}).optional();

export const UpdateUserLicenseInput = z.object({
  userId: z.string().min(1, "userId is required"),
  licensed: z.boolean(),
  confirm: z.boolean().optional(),
}).strict();

export const BulkLicenseUsersInput = z.object({
  userIds: z.array(z.string().min(1)).min(1, "At least one userId required"),
  confirm: z.boolean().optional(),
}).strict();

export const LicenseByRoleInput = z.object({
  role: z.string().min(1, "role is required"),
  confirm: z.boolean().optional(),
}).strict();

export const LicenseByProfileInput = z.object({
  profile: z.string().min(1, "profile is required"),
  confirm: z.boolean().optional(),
}).strict();

// Routing
export const RouteLeadInput = z.object({
  objectType: ObjectTypeEnum,
  eventType: EventTypeEnum,
  recordId: z.string().min(1, "recordId is required"),
  fields: z.record(z.string(), z.unknown()),
  ruleId: z.string().optional(),
}).strict();

export const RouteBatchInput = z.object({
  objectType: ObjectTypeEnum,
  eventType: EventTypeEnum,
  records: z.array(z.object({
    recordId: z.string(),
    fields: z.record(z.string(), z.unknown()),
  })).optional(),
  csv: z.string().optional(),
  recordIdColumn: z.string().optional(),
}).strict();

// Logs
export const GetRoutingLogsInput = z.object({
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
  objectType: ObjectTypeEnum.optional(),
  status: z.string().optional(),
  ruleId: z.string().optional(),
}).optional();

export const GetRecordJourneyInput = z.object({
  recordId: z.string().min(1, "recordId is required"),
}).strict();

export const RetryRoutingInput = z.object({
  logId: z.string().min(1, "logId is required"),
  confirm: z.boolean().optional(),
}).strict();

export const DismissLogInput = z.object({
  logId: z.string().min(1, "logId is required"),
  confirm: z.boolean().optional(),
}).strict();

// Analytics
export const DateRangeInput = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
}).optional();

// Flows
export const GetFlowInput = z.object({
  objectType: ObjectTypeEnum,
}).strict();

export const TestFlowInput = z.object({
  objectType: ObjectTypeEnum,
  fields: z.record(z.string(), z.unknown()),
}).strict();

// Audit logs
export const GetAuditLogsInput = z.object({
  page: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).optional(),
  action: z.string().optional(),
  entityType: z.string().optional(),
}).optional();

// Fields
export const ListFieldsInput = z.object({
  objectType: z.string().optional(),
}).optional();

// Routing mode
export const SetRoutingModeInput = z.object({
  mode: RoutingModeEnum,
  confirm: z.boolean().optional(),
}).strict();

// Bulk run
export const GetBulkRunStatusInput = z.object({
  runId: z.string().min(1, "runId is required"),
}).strict();

export const CancelBulkRunInput = z.object({
  runId: z.string().min(1, "runId is required"),
  confirm: z.boolean().optional(),
}).strict();
