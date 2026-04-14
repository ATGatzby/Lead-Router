import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const getTeamWorkloadCompositeTool = {
  name: "get_team_workload",
  description:
    "Get team workload distribution showing each member's assignment count, capacity, and balance. " +
    "PREFERRED over list_teams + get_analytics_teams for workload analysis. " +
    "Shows which members are overloaded or underutilized.",
  inputSchema: {
    type: "object" as const,
    properties: {
      teamId: {
        type: "string",
        description: "Specific team ID. If omitted, returns workload for all teams.",
      },
    },
  },
};

export async function handleGetTeamWorkloadComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1GetTeamWorkload(args?.teamId);
    const durationMs = Date.now() - start;
    logger.log({ tool: "get_team_workload", action: "execute", input: args, result, durationMs });

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
    logger.log({ tool: "get_team_workload", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (list_teams, get_analytics_teams) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
