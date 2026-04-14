import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const updateTeamTool = {
  name: "update_team",
  description: "Update an existing routing team. First call without confirm to see before/after diff, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      teamId: {
        type: "string",
        description: "The ID of the team to update",
      },
      name: { type: "string", description: "New team name" },
      description: { type: "string", description: "New description" },
      distributionType: {
        type: "string",
        enum: ["round-robin", "weighted"],
        description: "New distribution type",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the update. Defaults to false (preview only).",
      },
    },
    required: ["teamId"],
  },
};

export async function handleUpdateTeam(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { teamId, confirm, ...updates } = args;

  if (!confirm) {
    const current = await web.getTeam(teamId);
    const lines = [`Will update team: ${current.name} (${teamId})`, "", "Changes:"];
    for (const [key, value] of Object.entries(updates)) {
      const before = (current as any)[key];
      lines.push(`  ${key}: ${String(before ?? "—")} -> ${String(value)}`);
    }
    logger.log({ tool: "update_team", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.updateTeam(teamId, updates);
  logger.log({ tool: "update_team", action: "execute", input: args, result, durationMs: Date.now() - start });
  return successResponse(`Team updated successfully.\nID: ${result.id}\nName: ${result.name}`);
}
