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
  const data = await web.getRoutingStats() as any;
  logger.log({ tool: "get_routing_stats", action: "read", durationMs: Date.now() - start });

  const lines = ["Routing Statistics"];

  const stats = data.stats || data;
  if (Array.isArray(stats) && stats.length) {
    for (const s of stats) {
      lines.push(`\n• ${s.name ?? "Unknown"}: ${s.total ?? 0} total`);
      for (const key of Object.keys(s)) {
        if (!["name", "total"].includes(key) && typeof s[key] === "number") {
          lines.push(`    ${key}: ${s[key]}`);
        }
      }
    }
  }

  if (data.period) lines.push(`\nPeriod: ${data.period}`);

  return successResponse(lines.join("\n"));
}
