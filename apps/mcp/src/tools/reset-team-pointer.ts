import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const resetTeamPointerTool = {
  name: "reset_team_pointer",
  description: "Reset the round-robin pointer for a team back to the first member. First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      teamId: {
        type: "string",
        description: "The ID of the team to reset the pointer for",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. Defaults to false (preview only).",
      },
    },
    required: ["teamId"],
  },
};

export async function handleResetTeamPointer(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { teamId, confirm } = args;

  if (!confirm) {
    const team = await web.getTeam(teamId);
    const lines = [
      "Will reset round-robin pointer:",
      `  Team: ${team.name} (${teamId})`,
      `  Distribution: ${team.distributionMethod || "ROUND_ROBIN"}`,
    ];
    logger.log({ tool: "reset_team_pointer", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.resetTeamPointer(teamId);
  logger.log({ tool: "reset_team_pointer", action: "execute", input: args, result, durationMs: Date.now() - start });
  return successResponse(`Round-robin pointer for team ${teamId} reset to first member.`);
}
