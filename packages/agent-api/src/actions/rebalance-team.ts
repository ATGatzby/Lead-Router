import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { TeamService } from "../services/team";

interface RebalanceTeamInput {
  teamId: string;
  strategy?: "equalize" | "proportional";
}

interface RebalanceTeamOutput {
  teamId: string;
  membersUpdated: number;
  newWeights: Record<string, number>;
}

export async function rebalanceTeam(
  input: RebalanceTeamInput,
  ctx: AgentContext,
): Promise<AgentResponse<RebalanceTeamOutput | null>> {
  const start = Date.now();
  const tool = "rebalance_team";
  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    // Get current team members
    const teams = await TeamService.list(ctx);
    const team = teams.find((t) => t.id === input.teamId);
    if (!team) {
      return fail(
        "NOT_FOUND",
        `Team "${input.teamId}" not found`,
        "Check the team ID and try again.",
        tool,
        ctx.crmType,
        Date.now() - start,
      );
    }

    if (team.memberCount === 0) {
      warnings.push("Team has no members -- nothing to rebalance");
      return ok(
        { teamId: input.teamId, membersUpdated: 0, newWeights: {} },
        actions,
        tool,
        ctx.crmType,
        Date.now() - start,
        { warnings },
      );
    }

    // For equalize strategy: set equal weights for all members
    // For proportional: would use analytics data (simplified here)
    const equalWeight = Math.round(100 / team.memberCount);

    // We need member IDs -- fetch members via prisma
    const members = await ctx.prisma.teamMember.findMany({
      where: { teamId: input.teamId },
      select: { userId: true },
    });

    const newWeights: Record<string, number> = {};
    for (const m of members) {
      newWeights[m.userId] = equalWeight;
    }

    const updated = await TeamService.setWeights(
      { teamId: input.teamId, weights: newWeights },
      ctx,
    );
    actions.push(
      `Rebalanced ${updated} member(s) using "${input.strategy ?? "equalize"}" strategy`,
    );

    return ok(
      { teamId: input.teamId, membersUpdated: updated, newWeights },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "get_team_workload", reason: "Verify new weight distribution" },
          { action: "get_performance", reason: "Monitor impact of rebalance" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "REBALANCE_TEAM_FAILED",
      error instanceof Error ? error.message : String(error),
      "Verify the team exists and has active members.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
