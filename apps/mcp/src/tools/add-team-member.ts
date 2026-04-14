import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const addTeamMemberTool = {
  name: "add_team_member",
  description: "Add a user to a routing team. First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      teamId: {
        type: "string",
        description: "The ID of the team to add the member to",
      },
      userId: {
        type: "string",
        description: "The ID of the user to add",
      },
      weight: {
        type: "number",
        description: "Optional weight for weighted distribution (default 1)",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. Defaults to false (preview only).",
      },
    },
    required: ["teamId", "userId"],
  },
};

export async function handleAddTeamMember(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { teamId, userId, weight, confirm } = args;

  if (!confirm) {
    const team = await web.getTeam(teamId);
    const lines = [
      "Will add team member:",
      `  Team: ${team.name} (${teamId})`,
      `  User ID: ${userId}`,
    ];
    if (weight !== undefined) lines.push(`  Weight: ${weight}`);
    logger.log({ tool: "add_team_member", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const data: Record<string, unknown> = { userIds: [userId] };
  const result = await web.addTeamMember(teamId, data);

  // If weight was specified, set it via a separate weights update call
  if (weight !== undefined) {
    await web.updateTeamWeights(teamId, [{ userId, weight }]);
  }

  logger.log({ tool: "add_team_member", action: "execute", input: args, result, durationMs: Date.now() - start });
  return successResponse(`User ${userId} added to team ${teamId} successfully.${weight !== undefined ? ` Weight set to ${weight}.` : ""}`);
}
