import { z } from "zod";

// ─── Shared enums ────────────────────────────────────────────────────────────

export const ObjectTypeEnum = z.enum(["LEAD", "CONTACT", "ACCOUNT", "COMPANY", "DEAL"]);
export const TriggerEventEnum = z.enum(["INSERT", "UPDATE", "BOTH", "SEARCH"]);
export const AssignmentTypeEnum = z.enum(["USER", "ROUND_ROBIN", "QUEUE"]);
export const DistributionStrategyEnum = z.enum(["round_robin", "weighted", "manual"]);
export const RoutingModeEnum = z.enum(["CLASSIC", "FLOW"]);
export const LogStatusEnum = z.enum(["SUCCESS", "FAILED", "UNMATCHED", "RETRY", "MERGED"]);
export const ExportFormatEnum = z.enum(["csv", "json"]);

// ─── 1. setup_team ──────────────────────────────────────────────────────────

export const setupTeamInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  strategy: DistributionStrategyEnum.default("round_robin"),
  members: z.array(z.string().email()).optional(),
  weights: z.record(z.string(), z.number().min(0)).optional(),
});
export type SetupTeamInput = z.infer<typeof setupTeamInput>;

// ─── 2. setup_routing_rule ──────────────────────────────────────────────────

export const setupRuleInput = z.object({
  name: z.string().min(1),
  objectType: ObjectTypeEnum,
  triggerEvent: TriggerEventEnum.default("INSERT"),
  criteria: z
    .array(
      z.object({
        field: z.string(),
        operator: z.string(),
        value: z.unknown(),
      }),
    )
    .optional(),
  assignTo: z.object({
    teamId: z.string().optional(),
    userId: z.string().optional(),
    queueId: z.string().optional(),
  }),
  activate: z.boolean().default(true),
});
export type SetupRuleInput = z.infer<typeof setupRuleInput>;

// ─── 3. sync_crm_schema ────────────────────────────────────────────────────

export const syncCrmSchemaInput = z.object({
  objectTypes: z.array(ObjectTypeEnum).optional(),
});
export type SyncCrmSchemaInput = z.infer<typeof syncCrmSchemaInput>;

// ─── 4. import_users ────────────────────────────────────────────────────────

export const importUsersInput = z.object({
  autoLicense: z.boolean().default(false),
  profileFilter: z.array(z.string()).optional(),
});
export type ImportUsersInput = z.infer<typeof importUsersInput>;

// ─── 5. route_record ────────────────────────────────────────────────────────

export const routeRecordInput = z.object({
  objectType: ObjectTypeEnum,
  eventType: TriggerEventEnum.default("INSERT"),
  recordId: z.string().min(1),
  fields: z.record(z.string(), z.unknown()),
  ruleId: z.string().optional(),
});
export type RouteRecordInput = z.infer<typeof routeRecordInput>;

// ─── 6. bulk_route ──────────────────────────────────────────────────────────

export const bulkRouteInput = z.object({
  objectType: ObjectTypeEnum,
  eventType: TriggerEventEnum.default("INSERT"),
  records: z.array(
    z.object({
      recordId: z.string().min(1),
      fields: z.record(z.string(), z.unknown()),
    }),
  ),
  ruleId: z.string().optional(),
});
export type BulkRouteInput = z.infer<typeof bulkRouteInput>;

// ─── 7. retry_failed ────────────────────────────────────────────────────────

export const retryFailedInput = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  ruleId: z.string().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});
export type RetryFailedInput = z.infer<typeof retryFailedInput>;

// ─── 8. toggle_routing ──────────────────────────────────────────────────────

export const toggleRoutingInput = z.object({
  objectType: ObjectTypeEnum,
  mode: RoutingModeEnum,
});
export type ToggleRoutingInput = z.infer<typeof toggleRoutingInput>;

// ─── 9. rebalance_team ──────────────────────────────────────────────────────

export const rebalanceTeamInput = z.object({
  teamId: z.string().min(1),
  strategy: z.enum(["equalize", "proportional"]).default("equalize"),
});
export type RebalanceTeamInput = z.infer<typeof rebalanceTeamInput>;

// ─── 10. update_rule_criteria ───────────────────────────────────────────────

export const updateRuleCriteriaInput = z.object({
  ruleId: z.string().min(1),
  criteria: z.array(
    z.object({
      field: z.string(),
      operator: z.string(),
      value: z.unknown(),
    }),
  ),
  syncToCrm: z.boolean().default(false),
});
export type UpdateRuleCriteriaInput = z.infer<typeof updateRuleCriteriaInput>;

// ─── 11. reorder_rules ──────────────────────────────────────────────────────

export const reorderRulesInput = z.object({
  objectType: ObjectTypeEnum,
  ruleIds: z.array(z.string().min(1)).min(1),
});
export type ReorderRulesInput = z.infer<typeof reorderRulesInput>;

// ─── 12. clone_and_modify_rule ──────────────────────────────────────────────

export const cloneAndModifyRuleInput = z.object({
  sourceRuleId: z.string().min(1),
  newName: z.string().min(1).optional(),
  modifications: z
    .object({
      objectType: ObjectTypeEnum.optional(),
      triggerEvent: TriggerEventEnum.optional(),
      assignTo: z
        .object({
          teamId: z.string().optional(),
          userId: z.string().optional(),
          queueId: z.string().optional(),
        })
        .optional(),
      activate: z.boolean().optional(),
    })
    .optional(),
});
export type CloneAndModifyRuleInput = z.infer<typeof cloneAndModifyRuleInput>;

// ─── 13. get_routing_status ─────────────────────────────────────────────────

export const getRoutingStatusInput = z.object({}).optional();
export type GetRoutingStatusInput = z.infer<typeof getRoutingStatusInput>;

// ─── 14. get_performance ────────────────────────────────────────────────────

export const getPerformanceInput = z.object({
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
  ruleId: z.string().optional(),
  teamId: z.string().optional(),
});
export type GetPerformanceInput = z.infer<typeof getPerformanceInput>;

// ─── 15. get_team_workload ──────────────────────────────────────────────────

export const getTeamWorkloadInput = z.object({
  teamId: z.string().optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});
export type GetTeamWorkloadInput = z.infer<typeof getTeamWorkloadInput>;

// ─── 16. export_report ──────────────────────────────────────────────────────

export const exportReportInput = z.object({
  fromDate: z.string().datetime(),
  toDate: z.string().datetime(),
  format: ExportFormatEnum.default("csv"),
  objectType: ObjectTypeEnum.optional(),
  status: LogStatusEnum.optional(),
  ruleId: z.string().optional(),
  limit: z.number().int().min(1).max(10000).default(5000),
});
export type ExportReportInput = z.infer<typeof exportReportInput>;
