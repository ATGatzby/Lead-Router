import { z } from "zod";

// ─── 1. setup_team ──────────────────────────────────────────────────────────

export const setupTeamResponse = z.object({
  team_id: z.string(),
  name: z.string(),
  strategy: z.string(),
  members_added: z.number(),
  members_not_found: z.array(z.string()).optional(),
});
export type SetupTeamResponse = z.infer<typeof setupTeamResponse>;

// ─── 2. setup_routing_rule ──────────────────────────────────────────────────

export const setupRuleResponse = z.object({
  rule_id: z.string(),
  name: z.string(),
  object_type: z.string(),
  trigger_event: z.string(),
  status: z.string(),
  priority: z.number(),
  assignment_type: z.string().nullable(),
});
export type SetupRuleResponse = z.infer<typeof setupRuleResponse>;

// ─── 3. sync_crm_schema ────────────────────────────────────────────────────

export const syncCrmSchemaResponse = z.object({
  objects_synced: z.array(
    z.object({
      object_type: z.string(),
      fields_synced: z.number(),
    }),
  ),
  queues_synced: z.number().optional(),
});
export type SyncCrmSchemaResponse = z.infer<typeof syncCrmSchemaResponse>;

// ─── 4. import_users ────────────────────────────────────────────────────────

export const importUsersResponse = z.object({
  users_synced: z.number(),
  users_licensed: z.number().optional(),
});
export type ImportUsersResponse = z.infer<typeof importUsersResponse>;

// ─── 5. route_record ────────────────────────────────────────────────────────

export const routeRecordResponse = z.object({
  status: z.string(),
  latency_ms: z.number().optional(),
  rule_id: z.string().optional(),
  assigned_to: z.string().optional(),
});
export type RouteRecordResponse = z.infer<typeof routeRecordResponse>;

// ─── 6. bulk_route ──────────────────────────────────────────────────────────

export const bulkRouteResponse = z.object({
  accepted: z.number(),
  duplicates: z.number(),
  batch_id: z.string().optional(),
});
export type BulkRouteResponse = z.infer<typeof bulkRouteResponse>;

// ─── 7. retry_failed ────────────────────────────────────────────────────────

export const retryFailedResponse = z.object({
  retried: z.number(),
  skipped: z.number(),
});
export type RetryFailedResponse = z.infer<typeof retryFailedResponse>;

// ─── 8. toggle_routing ──────────────────────────────────────────────────────

export const toggleRoutingResponse = z.object({
  modes: z.record(z.string(), z.string()),
});
export type ToggleRoutingResponse = z.infer<typeof toggleRoutingResponse>;

// ─── 9. rebalance_team ──────────────────────────────────────────────────────

export const rebalanceTeamResponse = z.object({
  team_id: z.string(),
  members_updated: z.number(),
  new_weights: z.record(z.string(), z.number()),
});
export type RebalanceTeamResponse = z.infer<typeof rebalanceTeamResponse>;

// ─── 10. update_rule_criteria ───────────────────────────────────────────────

export const updateRuleCriteriaResponse = z.object({
  rule_id: z.string(),
  criteria_count: z.number(),
  synced_to_crm: z.boolean(),
});
export type UpdateRuleCriteriaResponse = z.infer<typeof updateRuleCriteriaResponse>;

// ─── 11. reorder_rules ──────────────────────────────────────────────────────

export const reorderRulesResponse = z.object({
  object_type: z.string(),
  new_order: z.array(
    z.object({
      rule_id: z.string(),
      priority: z.number(),
    }),
  ),
});
export type ReorderRulesResponse = z.infer<typeof reorderRulesResponse>;

// ─── 12. clone_and_modify_rule ──────────────────────────────────────────────

export const cloneAndModifyRuleResponse = z.object({
  source_rule_id: z.string(),
  new_rule_id: z.string(),
  name: z.string(),
  status: z.string(),
});
export type CloneAndModifyRuleResponse = z.infer<typeof cloneAndModifyRuleResponse>;

// ─── 13. get_routing_status ─────────────────────────────────────────────────

export const getRoutingStatusResponse = z.object({
  crm_connected: z.boolean(),
  crm_type: z.string(),
  routing_modes: z.record(z.string(), z.string()),
  active_rules: z.number(),
  total_rules: z.number(),
  teams: z.number(),
  users_licensed: z.number(),
});
export type GetRoutingStatusResponse = z.infer<typeof getRoutingStatusResponse>;

// ─── 14. get_performance ────────────────────────────────────────────────────

export const getPerformanceResponse = z.object({
  total_routed: z.number(),
  success_rate: z.number(),
  avg_speed_seconds: z.number().nullable(),
  status_breakdown: z.object({
    success: z.number(),
    failed: z.number(),
    unmatched: z.number(),
    merged: z.number(),
  }),
});
export type GetPerformanceResponse = z.infer<typeof getPerformanceResponse>;

// ─── 15. get_team_workload ──────────────────────────────────────────────────

export const getTeamWorkloadResponse = z.object({
  teams: z.array(
    z.object({
      team_id: z.string(),
      name: z.string(),
      member_count: z.number(),
      active_count: z.number(),
      total_assigned: z.number(),
    }),
  ),
});
export type GetTeamWorkloadResponse = z.infer<typeof getTeamWorkloadResponse>;

// ─── 16. export_report ──────────────────────────────────────────────────────

export const exportReportResponse = z.object({
  format: z.string(),
  record_count: z.number(),
  data: z.unknown(),
});
export type ExportReportResponse = z.infer<typeof exportReportResponse>;
