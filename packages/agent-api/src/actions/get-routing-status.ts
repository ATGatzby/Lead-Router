import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { StatusService } from "../services/status";

interface GetRoutingStatusOutput {
  crmConnected: boolean;
  crmType: string;
  routingModes: Record<string, string>;
  activeRules: number;
  totalRules: number;
  teams: number;
  usersLicensed: number;
}

export async function getRoutingStatus(
  _input: Record<string, unknown> | undefined,
  ctx: AgentContext,
): Promise<AgentResponse<GetRoutingStatusOutput | null>> {
  const start = Date.now();
  const tool = "get_routing_status";
  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    const status = await StatusService.health(ctx);
    actions.push("Retrieved routing status and health checks");

    if (!status.crmConnected) {
      warnings.push("CRM is not connected -- routing will not work until reconnected");
    }
    if (status.activeRules === 0) {
      warnings.push("No active routing rules -- incoming records will not be routed");
    }

    const nextActions: Array<{ action: string; reason: string }> = [];
    if (status.activeRules === 0) {
      nextActions.push({ action: "setup_routing_rule", reason: "Create and activate a routing rule" });
    }
    if (!status.crmConnected) {
      nextActions.push({ action: "sync_crm_schema", reason: "Re-sync CRM connection" });
    }
    nextActions.push({ action: "get_performance", reason: "View detailed analytics" });

    return ok(
      {
        crmConnected: status.crmConnected,
        crmType: status.crmType,
        routingModes: status.routingModes,
        activeRules: status.activeRules,
        totalRules: status.totalRules,
        teams: status.teams,
        usersLicensed: status.usersLicensed,
      },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: nextActions,
      },
    );
  } catch (error) {
    return fail(
      "STATUS_CHECK_FAILED",
      error instanceof Error ? error.message : String(error),
      "Check database connectivity. This is a read-only operation -- retry is safe.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
