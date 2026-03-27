import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getRoutingStatsTool = {
  name: "get_routing_stats",
  description: "Get routing log statistics — counts by status, object type, and recent trends.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleGetRoutingStats(web: WebClient, logger: Logger) {
  const start = Date.now();
  const data = await web.getRoutingStats();
  logger.log({ tool: "get_routing_stats", action: "read", durationMs: Date.now() - start });

  const lines = ["Routing Statistics"];

  if (data.byStatus) {
    lines.push("\nBy Status:");
    for (const [status, count] of Object.entries(data.byStatus)) {
      lines.push(`  ${status}: ${count}`);
    }
  }

  if (data.byObjectType) {
    lines.push("\nBy Object Type:");
    for (const [type, count] of Object.entries(data.byObjectType)) {
      lines.push(`  ${type}: ${count}`);
    }
  }

  if (data.total !== undefined) lines.push(`\nTotal: ${data.total}`);

  return successResponse(lines.join("\n"));
}
