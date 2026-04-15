// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  CrmType,
  AgentContext,
  EngineGateway,
  RoutePayload,
  BatchPayload,
  RouteResult,
  BatchResult,
  AgentResponse,
} from "./types";
export { ok, fail } from "./types";

// ─── Errors ──────────────────────────────────────────────────────────────────
export {
  AgentError,
  NotFoundError,
  CrmUnsupportedError,
  ValidationError,
  EngineGatewayRequiredError,
} from "./errors";

// ─── Input Schemas ───────────────────────────────────────────────────────────
export {
  ObjectTypeEnum,
  TriggerEventEnum,
  AssignmentTypeEnum,
  DistributionStrategyEnum,
  RoutingModeEnum,
  LogStatusEnum,
  ExportFormatEnum,
  setupTeamInput,
  setupRuleInput,
  syncCrmSchemaInput,
  importUsersInput,
  routeRecordInput,
  bulkRouteInput,
  retryFailedInput,
  toggleRoutingInput,
  rebalanceTeamInput,
  updateRuleCriteriaInput,
  reorderRulesInput,
  cloneAndModifyRuleInput,
  getRoutingStatusInput,
  getPerformanceInput,
  getTeamWorkloadInput,
  exportReportInput,
} from "./schemas/inputs";
export type {
  SetupTeamInput,
  SetupRuleInput,
  SyncCrmSchemaInput,
  ImportUsersInput,
  RouteRecordInput,
  BulkRouteInput,
  RetryFailedInput,
  ToggleRoutingInput,
  RebalanceTeamInput,
  UpdateRuleCriteriaInput,
  ReorderRulesInput,
  CloneAndModifyRuleInput,
  GetRoutingStatusInput,
  GetPerformanceInput,
  GetTeamWorkloadInput,
  ExportReportInput,
} from "./schemas/inputs";

// ─── Response Schemas ────────────────────────────────────────────────────────
export {
  setupTeamResponse,
  setupRuleResponse,
  syncCrmSchemaResponse,
  importUsersResponse,
  routeRecordResponse,
  bulkRouteResponse,
  retryFailedResponse,
  toggleRoutingResponse,
  rebalanceTeamResponse,
  updateRuleCriteriaResponse,
  reorderRulesResponse,
  cloneAndModifyRuleResponse,
  getRoutingStatusResponse,
  getPerformanceResponse,
  getTeamWorkloadResponse,
  exportReportResponse,
} from "./schemas/responses";
export type {
  SetupTeamResponse,
  SetupRuleResponse,
  SyncCrmSchemaResponse,
  ImportUsersResponse,
  RouteRecordResponse,
  BulkRouteResponse,
  RetryFailedResponse,
  ToggleRoutingResponse,
  RebalanceTeamResponse,
  UpdateRuleCriteriaResponse,
  ReorderRulesResponse,
  CloneAndModifyRuleResponse,
  GetRoutingStatusResponse,
  GetPerformanceResponse,
  GetTeamWorkloadResponse,
  ExportReportResponse,
} from "./schemas/responses";

// ─── Services ────────────────────────────────────────────────────────────────
export { TeamService } from "./services/team";
export { RuleService } from "./services/rule";
export { AnalyticsService } from "./services/analytics";
export { RoutingService } from "./services/routing";
export { StatusService } from "./services/status";
export { UserService } from "./services/user";
export { FieldService } from "./services/field";
export { QueueService } from "./services/queue";
export { LogService } from "./services/log";

// ─── Observability ─────────────────────────────────────────────────────────
export { logToolCall, getCategory } from "./observability/tool-call-log";
export { exportToLangfuse, shutdownLangfuse } from "./observability/langfuse-exporter";

// ─── OpenAPI ────────────────────────────────────────────────────────────────
export { generateOpenAPISpec } from "./openapi";

// ─── Actions ─────────────────────────────────────────────────────────────────
export { setupTeam } from "./actions/setup-team";
export { setupRule } from "./actions/setup-rule";
export { syncCrm } from "./actions/sync-crm";
export { importUsers } from "./actions/import-users";
export { routeRecord } from "./actions/route-record";
export { bulkRoute } from "./actions/bulk-route";
export { retryFailed } from "./actions/retry-failed";
export { toggleRouting } from "./actions/toggle-routing";
export { rebalanceTeam } from "./actions/rebalance-team";
export { updateRuleCriteria } from "./actions/update-rule-criteria";
export { reorderRules } from "./actions/reorder-rules";
export { cloneModifyRule } from "./actions/clone-modify-rule";
export { getRoutingStatus } from "./actions/get-routing-status";
export { getPerformance } from "./actions/get-performance";
export { getTeamWorkload } from "./actions/get-team-workload";
export { exportReport } from "./actions/export-report";
