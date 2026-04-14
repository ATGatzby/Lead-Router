import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const getPerformanceCompositeTool = {
  name: "get_performance",
  description:
    "Get routing performance metrics including throughput, latency, success rates, and trends. " +
    "PREFERRED over get_analytics_overview + get_analytics_rules + get_analytics_teams. " +
    "Returns a unified performance dashboard view.",
  inputSchema: {
    type: "object" as const,
    properties: {
      period: {
        type: "string",
        enum: ["1h", "24h", "7d", "30d"],
        description: "Time period for metrics. Defaults to 24h.",
      },
    },
  },
};

export async function handleGetPerformanceComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1GetPerformance(args?.period);
    const durationMs = Date.now() - start;
    logger.log({ tool: "get_performance", action: "execute", input: args, result, durationMs });

    if (!result.success) {
      return errorResponse(`${result.error?.message}\n\nRemediation: ${result.error?.remediation}`);
    }

    const lines = [
      ...result.actions_taken.map((a: string) => `✓ ${a}`),
    ];
    if (result.data) {
      lines.push("", JSON.stringify(result.data, null, 2));
    }
    if (result.warnings?.length) {
      lines.push("", "Warnings:", ...result.warnings.map((w: string) => `⚠ ${w}`));
    }
    if (result.next_actions?.length) {
      lines.push("", "Suggested next:", ...result.next_actions.map((n: any) => `→ ${n.action}: ${n.reason}`));
    }
    return successResponse(lines.join("\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.log({ tool: "get_performance", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (get_analytics_overview, get_analytics_rules) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
