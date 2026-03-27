import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getAnalyticsRulesTool = {
  name: "get_analytics_rules",
  description: "Get per-rule analytics — route count, match rate, average latency per rule.",
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

export async function handleGetAnalyticsRules(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const data = await web.getAnalyticsRules(args?.from, args?.to);
  const rules = data.rules || data;
  logger.log({ tool: "get_analytics_rules", action: "read", input: args, durationMs: Date.now() - start });

  if (!Array.isArray(rules) || !rules.length) return successResponse("No per-rule analytics found.");

  const text = rules
    .map((r: any, i: number) =>
      `${i + 1}. ${r.name ?? r.ruleId}\n   Route Count: ${r.routeCount ?? "—"} | Match Rate: ${r.matchRate != null ? `${r.matchRate}%` : "—"} | Avg Latency: ${r.avgLatency != null ? `${r.avgLatency}ms` : "—"}`
    )
    .join("\n\n");

  return successResponse(text);
}
