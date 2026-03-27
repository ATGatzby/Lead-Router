import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getAnalyticsOverviewTool = {
  name: "get_analytics_overview",
  description: "Get routing analytics overview — total routed, unmatched, failed, average latency.",
  inputSchema: {
    type: "object" as const,
    properties: {
      from: {
        type: "string",
        description: "Start date (ISO string, e.g. 2026-01-01)",
      },
      to: {
        type: "string",
        description: "End date (ISO string, e.g. 2026-03-18)",
      },
    },
  },
};

export async function handleGetAnalyticsOverview(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const data = await web.getAnalyticsOverview(args?.from, args?.to);
  logger.log({ tool: "get_analytics_overview", action: "read", input: args, durationMs: Date.now() - start });

  const lines = [
    "Analytics Overview",
    `  Total Routed: ${data.totalRouted ?? "—"}`,
    `  Unmatched: ${data.unmatched ?? "—"}`,
    `  Failed: ${data.failed ?? "—"}`,
    `  Avg Latency: ${data.avgLatency != null ? `${data.avgLatency}ms` : "—"}`,
  ];
  if (data.from) lines.push(`  Period: ${data.from} → ${data.to}`);

  return successResponse(lines.join("\n"));
}
