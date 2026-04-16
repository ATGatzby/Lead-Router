import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { EngineClient } from "./clients/engine-client.js";
import { WebClient } from "./clients/web-client.js";
import { Logger } from "./utils/logger.js";
import { validateInput, type ZodSchema } from "./utils/validate.js";
import * as V from "./utils/validate.js";

// Tool imports
import { checkHealthTool, handleCheckHealth } from "./tools/check-health.js";
import { listRulesTool, handleListRules } from "./tools/list-rules.js";
import { getRuleTool, handleGetRule } from "./tools/get-rule.js";
import { createRuleTool, handleCreateRule } from "./tools/create-rule.js";
import { updateRuleTool, handleUpdateRule } from "./tools/update-rule.js";
import { deleteRuleTool, handleDeleteRule } from "./tools/delete-rule.js";
import { listTeamsTool, handleListTeams } from "./tools/list-teams.js";
import { createTeamTool, handleCreateTeam } from "./tools/create-team.js";
import { updateTeamTool, handleUpdateTeam } from "./tools/update-team.js";
import { deleteTeamTool, handleDeleteTeam } from "./tools/delete-team.js";
import { addTeamMemberTool, handleAddTeamMember } from "./tools/add-team-member.js";
import { removeTeamMemberTool, handleRemoveTeamMember } from "./tools/remove-team-member.js";
import { listUsersTool, handleListUsers } from "./tools/list-users.js";
import { syncUsersTool, handleSyncUsers } from "./tools/sync-users.js";
import { routeLeadTool, handleRouteLead } from "./tools/route-lead.js";
import { routeBatchTool, handleRouteBatch } from "./tools/route-batch.js";
import { getRoutingLogsTool, handleGetRoutingLogs } from "./tools/get-routing-logs.js";
import { getRecordJourneyTool, handleGetRecordJourney } from "./tools/get-record-journey.js";
import { updateUserLicenseTool, handleUpdateUserLicense } from "./tools/update-user-license.js";
import { cloneRuleTool, handleCloneRule } from "./tools/clone-rule.js";
import { reorderRulesTool, handleReorderRules } from "./tools/reorder-rules.js";
import { testRuleTool, handleTestRule } from "./tools/test-rule.js";
import { runScheduledRuleTool, handleRunScheduledRule } from "./tools/run-scheduled-rule.js";
import { toggleTeamMemberTool, handleToggleTeamMember } from "./tools/toggle-team-member.js";
import { updateTeamWeightsTool, handleUpdateTeamWeights } from "./tools/update-team-weights.js";
import { resetTeamPointerTool, handleResetTeamPointer } from "./tools/reset-team-pointer.js";
import { getAnalyticsOverviewTool, handleGetAnalyticsOverview } from "./tools/get-analytics-overview.js";
import { getAnalyticsRulesTool, handleGetAnalyticsRules } from "./tools/get-analytics-rules.js";
import { getAnalyticsTeamsTool, handleGetAnalyticsTeams } from "./tools/get-analytics-teams.js";
import { getRoutingStatsTool, handleGetRoutingStats } from "./tools/get-routing-stats.js";
import { getFailedLogsTool, handleGetFailedLogs } from "./tools/get-failed-logs.js";
import { retryRoutingTool, handleRetryRouting } from "./tools/retry-routing.js";
import { retryAllFailedTool, handleRetryAllFailed } from "./tools/retry-all-failed.js";
import { dismissLogTool, handleDismissLog } from "./tools/dismiss-log.js";
// Flow Builder tools excluded — feature not public yet (files gitignored)
// import { listFlowsTool, handleListFlows } from "./tools/list-flows.js";
// import { getFlowTool, handleGetFlow } from "./tools/get-flow.js";
// import { testFlowTool, handleTestFlow } from "./tools/test-flow.js";
import { getAuditLogsTool, handleGetAuditLogs } from "./tools/get-audit-logs.js";
import { getUserStatsTool, handleGetUserStats } from "./tools/get-user-stats.js";
import { listFieldsTool, handleListFields } from "./tools/list-fields.js";
import { syncFieldsTool, handleSyncFields } from "./tools/sync-fields.js";
import { listQueuesTool, handleListQueues } from "./tools/list-queues.js";
import { syncQueuesTool, handleSyncQueues } from "./tools/sync-queues.js";
import { getRoutingModeTool, handleGetRoutingMode } from "./tools/get-routing-mode.js";
import { setRoutingModeTool, handleSetRoutingMode } from "./tools/set-routing-mode.js";
import { bulkLicenseUsersTool, handleBulkLicenseUsers } from "./tools/bulk-license-users.js";
import { licenseUsersByRoleTool, handleLicenseUsersByRole } from "./tools/license-users-by-role.js";
import { licenseUsersByProfileTool, handleLicenseUsersByProfile } from "./tools/license-users-by-profile.js";
import { getSfdcStatusTool, handleGetSfdcStatus } from "./tools/get-sfdc-status.js";
import { getBulkRunStatusTool, handleGetBulkRunStatus } from "./tools/get-bulk-run-status.js";
import { cancelBulkRunTool, handleCancelBulkRun } from "./tools/cancel-bulk-run.js";
import { getLicenseInfoTool, handleGetLicenseInfo } from "./tools/get-license-info.js";

// Resource imports
import { rulesResource, handleRulesResource } from "./resources/rules-resource.js";
import { teamsResource, handleTeamsResource } from "./resources/teams-resource.js";

const config = loadConfig();
const engine = new EngineClient(config);
const web = new WebClient(config);
const logger = new Logger(config.logDir);

const server = new Server(
  { name: "lead-routing", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } }
);

// --- Tools ---

const allTools = [
  checkHealthTool,
  listRulesTool,
  getRuleTool,
  createRuleTool,
  updateRuleTool,
  deleteRuleTool,
  listTeamsTool,
  createTeamTool,
  updateTeamTool,
  deleteTeamTool,
  addTeamMemberTool,
  removeTeamMemberTool,
  listUsersTool,
  syncUsersTool,
  routeLeadTool,
  routeBatchTool,
  getRoutingLogsTool,
  getRecordJourneyTool,
  updateUserLicenseTool,
  cloneRuleTool,
  reorderRulesTool,
  testRuleTool,
  runScheduledRuleTool,
  toggleTeamMemberTool,
  updateTeamWeightsTool,
  resetTeamPointerTool,
  getAnalyticsOverviewTool,
  getAnalyticsRulesTool,
  getAnalyticsTeamsTool,
  getRoutingStatsTool,
  getFailedLogsTool,
  retryRoutingTool,
  retryAllFailedTool,
  dismissLogTool,
  // listFlowsTool, getFlowTool, testFlowTool — excluded (Flow Builder not public)
  getAuditLogsTool,
  getUserStatsTool,
  listFieldsTool,
  syncFieldsTool,
  listQueuesTool,
  syncQueuesTool,
  getRoutingModeTool,
  setRoutingModeTool,
  bulkLicenseUsersTool,
  licenseUsersByRoleTool,
  licenseUsersByProfileTool,
  getSfdcStatusTool,
  getBulkRunStatusTool,
  cancelBulkRunTool,
  getLicenseInfoTool,
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: allTools,
}));

// ── Input validation map ────────────────────────────────────────────────
// Maps tool names to their Zod validation schemas.
// Validated centrally before dispatching to handlers.
const validationMap: Record<string, ZodSchema> = {
  // Rules
  list_rules: V.ListRulesInput as ZodSchema,
  get_rule: V.GetRuleInput,
  create_rule: V.CreateRuleInput,
  update_rule: V.UpdateRuleInput,
  delete_rule: V.DeleteRuleInput,
  clone_rule: V.CloneRuleInput,
  reorder_rules: V.ReorderRulesInput,
  test_rule: V.TestRuleInput,
  run_scheduled_rule: V.RunScheduledRuleInput,
  // Teams
  create_team: V.CreateTeamInput,
  update_team: V.UpdateTeamInput,
  delete_team: V.DeleteTeamInput,
  add_team_member: V.AddTeamMemberInput,
  remove_team_member: V.RemoveTeamMemberInput,
  toggle_team_member: V.ToggleTeamMemberInput,
  update_team_weights: V.UpdateTeamWeightsInput,
  reset_team_pointer: V.ResetTeamPointerInput,
  // Users
  list_users: V.ListUsersInput as ZodSchema,
  update_user_license: V.UpdateUserLicenseInput,
  bulk_license_users: V.BulkLicenseUsersInput,
  license_users_by_role: V.LicenseByRoleInput,
  license_users_by_profile: V.LicenseByProfileInput,
  // Routing
  route_lead: V.RouteLeadInput,
  route_batch: V.RouteBatchInput,
  // Logs
  get_routing_logs: V.GetRoutingLogsInput as ZodSchema,
  get_record_journey: V.GetRecordJourneyInput,
  retry_routing: V.RetryRoutingInput,
  dismiss_log: V.DismissLogInput,
  // Analytics
  get_analytics_overview: V.DateRangeInput as ZodSchema,
  get_analytics_rules: V.DateRangeInput as ZodSchema,
  get_analytics_teams: V.DateRangeInput as ZodSchema,
  // Flows — excluded (Flow Builder not public)
  // get_flow: V.GetFlowInput,
  // test_flow: V.TestFlowInput,
  // Audit
  get_audit_logs: V.GetAuditLogsInput as ZodSchema,
  // Fields
  list_fields: V.ListFieldsInput as ZodSchema,
  // Routing mode
  set_routing_mode: V.SetRoutingModeInput,
  // Bulk runs
  get_bulk_run_status: V.GetBulkRunStatusInput,
  cancel_bulk_run: V.CancelBulkRunInput,
};

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const start = Date.now();

  try {
    // ── Validate input before dispatching ────────────────────────────
    const schema = validationMap[name];
    if (schema) {
      validateInput(schema, args ?? {});
    }

    switch (name) {
      case "check_health":
        return await handleCheckHealth(engine, logger);
      case "list_rules":
        return await handleListRules(web, logger, args);
      case "get_rule":
        return await handleGetRule(web, logger, args);
      case "create_rule":
        return await handleCreateRule(web, logger, args);
      case "update_rule":
        return await handleUpdateRule(web, logger, args);
      case "delete_rule":
        return await handleDeleteRule(web, logger, args);
      case "list_teams":
        return await handleListTeams(web, logger);
      case "create_team":
        return await handleCreateTeam(web, logger, args);
      case "update_team":
        return await handleUpdateTeam(web, logger, args);
      case "delete_team":
        return await handleDeleteTeam(web, logger, args);
      case "add_team_member":
        return await handleAddTeamMember(web, logger, args);
      case "remove_team_member":
        return await handleRemoveTeamMember(web, logger, args);
      case "list_users":
        return await handleListUsers(web, logger, args);
      case "sync_users":
        return await handleSyncUsers(web, logger);
      case "route_lead":
        return await handleRouteLead(engine, logger, args);
      case "route_batch":
        return await handleRouteBatch(engine, logger, args);
      case "get_routing_logs":
        return await handleGetRoutingLogs(web, logger, args);
      case "get_record_journey":
        return await handleGetRecordJourney(web, logger, args);
      case "update_user_license":
        return await handleUpdateUserLicense(web, logger, args);
      case "clone_rule":
        return await handleCloneRule(web, logger, args);
      case "reorder_rules":
        return await handleReorderRules(web, logger, args);
      case "test_rule":
        return await handleTestRule(web, logger, args);
      case "run_scheduled_rule":
        return await handleRunScheduledRule(web, logger, args);
      case "toggle_team_member":
        return await handleToggleTeamMember(web, logger, args);
      case "update_team_weights":
        return await handleUpdateTeamWeights(web, logger, args);
      case "reset_team_pointer":
        return await handleResetTeamPointer(web, logger, args);
      case "get_analytics_overview":
        return await handleGetAnalyticsOverview(web, logger, args);
      case "get_analytics_rules":
        return await handleGetAnalyticsRules(web, logger, args);
      case "get_analytics_teams":
        return await handleGetAnalyticsTeams(web, logger, args);
      case "get_routing_stats":
        return await handleGetRoutingStats(web, logger);
      case "get_failed_logs":
        return await handleGetFailedLogs(web, logger, args);
      case "retry_routing":
        return await handleRetryRouting(web, logger, args);
      case "retry_all_failed":
        return await handleRetryAllFailed(web, logger, args);
      case "dismiss_log":
        return await handleDismissLog(web, logger, args);
      // Flow Builder cases excluded — feature not public yet
      // case "list_flows": return await handleListFlows(web, logger);
      // case "get_flow": return await handleGetFlow(web, logger, args);
      // case "test_flow": return await handleTestFlow(web, logger, args);
      case "get_audit_logs":
        return await handleGetAuditLogs(web, logger, args);
      case "get_user_stats":
        return await handleGetUserStats(web, logger);
      case "list_fields":
        return await handleListFields(web, logger, args);
      case "sync_fields":
        return await handleSyncFields(web, logger, args);
      case "list_queues":
        return await handleListQueues(web, logger);
      case "sync_queues":
        return await handleSyncQueues(web, logger, args);
      case "get_routing_mode":
        return await handleGetRoutingMode(web, logger);
      case "set_routing_mode":
        return await handleSetRoutingMode(web, logger, args);
      case "bulk_license_users":
        return await handleBulkLicenseUsers(web, logger, args);
      case "license_users_by_role":
        return await handleLicenseUsersByRole(web, logger, args);
      case "license_users_by_profile":
        return await handleLicenseUsersByProfile(web, logger, args);
      case "get_sfdc_status":
        return await handleGetSfdcStatus(web, logger);
      case "get_bulk_run_status":
        return await handleGetBulkRunStatus(web, logger, args);
      case "cancel_bulk_run":
        return await handleCancelBulkRun(web, logger, args);
      case "get_license_info":
        return await handleGetLicenseInfo(web, logger);
      default:
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err: any) {
    logger.log({
      tool: name,
      action: "error",
      error: err.message,
      durationMs: Date.now() - start,
    });
    return {
      content: [{ type: "text" as const, text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// --- Resources ---

const allResources = [rulesResource, teamsResource];

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: allResources,
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  switch (uri) {
    case "lead-routing://rules":
      return await handleRulesResource(web);
    case "lead-routing://teams":
      return await handleTeamsResource(web);
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// --- Start ---

const transport = new StdioServerTransport();
await server.connect(transport);
