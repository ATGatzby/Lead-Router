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
  const data = await web.getAnalyticsRules(args?.from, args?.to) as any;
  const rules = data.rules || data;
  logger.log({ tool: "get_analytics_rules", action: "read", input: args, durationMs: Date.now() - start });

  if (!Array.isArray(rules) || !rules.length) return successResponse("No per-rule analytics found.");

  const text = rules
    .map((r: any, i: number) => {
      let line = `${i + 1}. ${r.ruleName ?? r.name ?? r.ruleId}`;
      line += `\n   Total: ${r.total ?? "—"} | Success: ${r.success ?? "—"} | Failed: ${r.failed ?? "—"} | Unmatched: ${r.unmatched ?? "—"}`;
      if (r.successRate != null) line += ` | Success Rate: ${r.successRate}%`;
      if (r.avgDurationMs != null) line += ` | Avg Duration: ${r.avgDurationMs}ms`;
      if (Array.isArray(r.paths) && r.paths.length) {
        line += "\n   Paths:";
        for (const p of r.paths) {
          line += `\n     • ${p.label || p.name}: ${p.count ?? "—"}`;
        }
      }
      return line;
    })
    .join("\n\n");

  return successResponse(text);
}
