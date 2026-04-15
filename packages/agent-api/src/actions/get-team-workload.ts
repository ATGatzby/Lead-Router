import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { TeamService } from "../services/team";

interface GetTeamWorkloadInput {
  teamId?: string;
}

interface GetTeamWorkloadOutput {
  teams: Array<{
    teamId: string;
    name: string;
    memberCount: number;
    activeCount: number;
    totalAssigned: number;
  }>;
}

export async function getTeamWorkload(
  input: GetTeamWorkloadInput,
  ctx: AgentContext,
): Promise<AgentResponse<GetTeamWorkloadOutput | null>> {
  const start = Date.now();
  const tool = "get_team_workload";
  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    const allTeams = await TeamService.list(ctx);
    const teams = input.teamId
      ? allTeams.filter((t) => t.id === input.teamId)
      : allTeams;

    if (input.teamId && teams.length === 0) {
      return fail(
        "NOT_FOUND",
        `Team "${input.teamId}" not found`,
        "Check the team ID and try again.",
        tool,
        ctx.crmType,
        Date.now() - start,
      );
    }

    actions.push(`Retrieved workload data for ${teams.length} team(s)`);

    // Warn about teams with no active members
    for (const t of teams) {
      if (t.activeCount === 0 && t.memberCount > 0) {
        warnings.push(`Team "${t.name}" has no active members`);
      }
    }

    return ok(
      {
        teams: teams.map((t) => ({
          teamId: t.id,
          name: t.name,
          memberCount: t.memberCount,
          activeCount: t.activeCount,
          totalAssigned: t.totalAssigned,
        })),
      },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "rebalance_team", reason: "Adjust weights for even distribution" },
          { action: "setup_team", reason: "Create a new team to split workload" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "TEAM_WORKLOAD_FAILED",
      error instanceof Error ? error.message : String(error),
      "Check database connectivity. This is a read-only operation -- retry is safe.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
