import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { TeamService } from "../services/team";

interface SetupTeamInput {
  name: string;
  description?: string;
  strategy?: "round_robin" | "weighted" | "manual";
  members?: string[];
  weights?: Record<string, number>;
}

interface SetupTeamOutput {
  teamId: string;
  name: string;
  strategy: string;
  membersAdded: number;
  membersNotFound: string[];
}

export async function setupTeam(
  input: SetupTeamInput,
  ctx: AgentContext,
): Promise<AgentResponse<SetupTeamOutput | null>> {
  const start = Date.now();
  const tool = "setup_team";
  const actions: string[] = [];
  const warnings: string[] = [];
  let teamId: string | undefined;

  try {
    const distributionType =
      input.strategy === "weighted" ? "weighted" : "round-robin";

    const team = await TeamService.create(
      { name: input.name, description: input.description, distributionType },
      ctx,
    );
    teamId = team.id;
    actions.push(`Created team "${input.name}" (${team.id})`);

    let membersAdded = 0;
    let membersNotFound: string[] = [];

    if (input.members?.length) {
      const result = await TeamService.addMembers(
        { teamId: team.id, emails: input.members },
        ctx,
      );
      membersAdded = result.added;
      membersNotFound = result.notFound;
      actions.push(`Added ${result.added} member(s) to team`);

      if (result.notFound.length > 0) {
        warnings.push(`Members not found: ${result.notFound.join(", ")}`);
      }
    }

    if (input.weights && Object.keys(input.weights).length > 0) {
      const updated = await TeamService.setWeights(
        { teamId: team.id, weights: input.weights },
        ctx,
      );
      actions.push(`Set custom weights for ${updated} member(s)`);
    }

    return ok(
      {
        teamId: team.id,
        name: input.name,
        strategy: distributionType,
        membersAdded,
        membersNotFound,
      },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "setup_routing_rule", reason: "Create a routing rule that uses this team" },
          { action: "get_team_workload", reason: "Check team capacity" },
        ],
      },
    );
  } catch (error) {
    if (teamId) {
      try {
        await TeamService.delete(teamId, ctx);
        actions.push(`Rolled back: deleted team ${teamId}`);
      } catch {
        // best-effort cleanup
      }
    }

    return fail(
      "SETUP_TEAM_FAILED",
      error instanceof Error ? error.message : String(error),
      "Check that all member emails exist in the system. Retry after fixing member list.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
