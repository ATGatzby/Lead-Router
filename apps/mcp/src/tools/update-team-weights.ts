import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const updateTeamWeightsTool = {
  name: "update_team_weights",
  description: "Update the distribution weights for team members. Higher weight = more assignments. First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      teamId: {
        type: "string",
        description: "The ID of the team",
      },
      weights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            userId: { type: "string", description: "The user ID" },
            weight: { type: "number", description: "The new weight value" },
          },
          required: ["userId", "weight"],
        },
        description: "Array of { userId, weight } pairs to update",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. Defaults to false (preview only).",
      },
    },
    required: ["teamId", "weights"],
  },
};

export async function handleUpdateTeamWeights(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { teamId, weights, confirm } = args;

  if (!confirm) {
    const team = await web.getTeam(teamId);
    const lines = [
      "Will update team member weights:",
      `  Team: ${team.name} (${teamId})`,
      `  Updates:`,
    ];
    for (const w of weights) {
      lines.push(`    - User ${w.userId}: weight = ${w.weight}`);
    }
    logger.log({ tool: "update_team_weights", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.updateTeamWeights(teamId, weights);
  logger.log({ tool: "update_team_weights", action: "execute", input: args, result, durationMs: Date.now() - start });
  return successResponse(`Weights updated for ${weights.length} member(s) in team ${teamId}.`);
}
