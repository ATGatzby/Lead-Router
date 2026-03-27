import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const removeTeamMemberTool = {
  name: "remove_team_member",
  description: "Remove a user from a routing team. First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      teamId: {
        type: "string",
        description: "The ID of the team to remove the member from",
      },
      userId: {
        type: "string",
        description: "The ID of the user to remove",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. Defaults to false (preview only).",
      },
    },
    required: ["teamId", "userId"],
  },
};

export async function handleRemoveTeamMember(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { teamId, userId, confirm } = args;

  if (!confirm) {
    const team = await web.getTeam(teamId);
    const lines = [
      "Will remove team member:",
      `  Team: ${team.name} (${teamId})`,
      `  User ID: ${userId}`,
    ];
    logger.log({ tool: "remove_team_member", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  await web.removeTeamMember(teamId, userId);
  logger.log({ tool: "remove_team_member", action: "execute", input: args, durationMs: Date.now() - start });
  return successResponse(`User ${userId} removed from team ${teamId} successfully.`);
}
