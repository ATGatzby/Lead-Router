import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { AnalyticsService } from "../services/analytics";

interface GetPerformanceInput {
  fromDate?: string;
  toDate?: string;
  ruleId?: string;
  teamId?: string;
}

interface GetPerformanceOutput {
  totalRouted: number;
  successRate: number;
  avgSpeedSeconds: number | null;
  statusBreakdown: {
    success: number;
    failed: number;
    unmatched: number;
    merged: number;
  };
  byRule: Array<{
    ruleId: string;
    ruleName: string;
    total: number;
    success: number;
    failed: number;
  }>;
  byTeam: Array<{
    teamId: string;
    teamName: string;
    total: number;
    success: number;
  }>;
}

export async function getPerformance(
  input: GetPerformanceInput,
  ctx: AgentContext,
): Promise<AgentResponse<GetPerformanceOutput | null>> {
  const start = Date.now();
  const tool = "get_performance";
  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    const now = new Date();
    const fromDate = input.fromDate ? new Date(input.fromDate) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const toDate = input.toDate ? new Date(input.toDate) : now;

    const filters = { fromDate, toDate, ruleId: input.ruleId, teamId: input.teamId };

    const [overview, rules, teams] = await Promise.all([
      AnalyticsService.overview(filters, ctx),
      AnalyticsService.rules(filters, ctx),
      AnalyticsService.teams(filters, ctx),
    ]);
    actions.push("Retrieved performance analytics");

    if (overview.statusBreakdown.failed > 0) {
      warnings.push(
        `${overview.statusBreakdown.failed} failed routing(s) in this period`,
      );
    }

    const nextActions: Array<{ action: string; reason: string }> = [];
    if (overview.statusBreakdown.failed > 0) {
      nextActions.push({ action: "retry_failed", reason: "Retry failed assignments" });
    }
    nextActions.push({ action: "rebalance_team", reason: "Optimize team weights based on data" });
    nextActions.push({ action: "export_report", reason: "Export detailed report" });

    return ok(
      {
        totalRouted: overview.totalRouted,
        successRate: overview.successRate,
        avgSpeedSeconds: overview.avgSpeedSeconds,
        statusBreakdown: overview.statusBreakdown,
        byRule: rules,
        byTeam: teams.map((t) => ({
          teamId: t.teamId,
          teamName: t.teamName,
          total: t.total,
          success: t.success,
        })),
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
      "PERFORMANCE_FETCH_FAILED",
      error instanceof Error ? error.message : String(error),
      "Check database connectivity. Analytics queries may timeout on large datasets -- try a shorter period.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
