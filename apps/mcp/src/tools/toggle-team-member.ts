import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const toggleTeamMemberTool = {
  name: "toggle_team_member",
  description: "Pause or activate a team member. Paused members are skipped in round-robin assignment. First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      teamId: {
        type: "string",
        description: "The ID of the team",
      },
      userId: {
        type: "string",
        description: "The ID of the user/member to toggle",
      },
      status: {
        type: "string",
        enum: ["ACTIVE", "PAUSED"],
        description: "The new status for the team member",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. Defaults to false (preview only).",
      },
    },
    required: ["teamId", "userId", "status"],
  },
};

export async function handleToggleTeamMember(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { teamId, userId, status, confirm } = args;

  if (!confirm) {
    const team = await web.getTeam(teamId);
    const lines = [
      "Will update team member status:",
      `  Team: ${team.name} (${teamId})`,
      `  User ID: ${userId}`,
      `  New Status: ${status}`,
    ];
    logger.log({ tool: "toggle_team_member", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.toggleTeamMember(teamId, userId, { status });
  logger.log({ tool: "toggle_team_member", action: "execute", input: args, result, durationMs: Date.now() - start });
  return successResponse(`Team member ${userId} in team ${teamId} set to ${status}.`);
}
