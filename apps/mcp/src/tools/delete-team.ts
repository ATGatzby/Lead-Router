import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const deleteTeamTool = {
  name: "delete_team",
  description: "Delete a routing team. First call without confirm to see what will be deleted, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      teamId: {
        type: "string",
        description: "The ID of the team to delete",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the deletion. Defaults to false (preview only).",
      },
    },
    required: ["teamId"],
  },
};

export async function handleDeleteTeam(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { teamId, confirm } = args;

  if (!confirm) {
    const team = await web.getTeam(teamId);
    const memberCount = team.members?.length ?? team._count?.members ?? "?";
    const lines = [
      "Will delete team:",
      `  Name: ${team.name}`,
      `  ID: ${teamId}`,
      `  Distribution: ${team.distributionType || "ROUND_ROBIN"}`,
      `  Members: ${memberCount}`,
    ];
    logger.log({ tool: "delete_team", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  await web.deleteTeam(teamId);
  logger.log({ tool: "delete_team", action: "execute", input: args, durationMs: Date.now() - start });
  return successResponse(`Team ${teamId} deleted successfully.`);
}
