import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const createTeamTool = {
  name: "create_team",
  description: "Create a new routing team. First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: {
        type: "string",
        description: "Name for the team",
      },
      description: {
        type: "string",
        description: "Optional description of the team",
      },
      distributionType: {
        type: "string",
        enum: ["ROUND_ROBIN", "WEIGHTED", "LOAD_BALANCED"],
        description: "How leads are distributed among team members. Defaults to ROUND_ROBIN.",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the creation. Defaults to false (preview only).",
      },
    },
    required: ["name"],
  },
};

export async function handleCreateTeam(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { confirm, ...data } = args;

  if (!confirm) {
    const lines = [
      "Will create team:",
      `  Name: ${data.name}`,
    ];
    if (data.description) lines.push(`  Description: ${data.description}`);
    lines.push(`  Distribution: ${data.distributionType || "ROUND_ROBIN"}`);
    logger.log({ tool: "create_team", action: "preview", input: data, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.createTeam(data);
  logger.log({ tool: "create_team", action: "execute", input: data, result, durationMs: Date.now() - start });
  return successResponse(`Team created successfully.\nID: ${result.id}\nName: ${result.name}`);
}
