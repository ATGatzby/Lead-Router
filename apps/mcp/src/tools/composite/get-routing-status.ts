import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const getRoutingStatusCompositeTool = {
  name: "get_routing_status",
  description:
    "Get a comprehensive routing system status including active rules, team health, " +
    "recent failures, and CRM connection state. " +
    "PREFERRED over calling get_routing_stats + list_rules + list_teams + get_sfdc_status separately.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleGetRoutingStatusComposite(web: WebClient, logger: Logger, _args: any) {
  const start = Date.now();
  try {
    const result = await web.v1GetRoutingStatus();
    const durationMs = Date.now() - start;
    logger.log({ tool: "get_routing_status", action: "execute", result, durationMs });

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
    logger.log({ tool: "get_routing_status", action: "error", error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (get_routing_stats, list_rules, get_sfdc_status) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
