import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const rebalanceTeamCompositeTool = {
  name: "rebalance_team",
  description:
    "Rebalance team member weights or reset the round-robin pointer. " +
    "PREFERRED over update_team_weights + reset_team_pointer. " +
    "Can auto-calculate equal weights or apply custom distribution.",
  inputSchema: {
    type: "object" as const,
    properties: {
      teamId: { type: "string", description: "Team ID to rebalance" },
      strategy: {
        type: "string",
        enum: ["equal", "custom", "performance_based"],
        description: "Rebalancing strategy. 'equal' distributes evenly, 'custom' uses provided weights.",
      },
      weights: {
        type: "object",
        description: "Custom weights map (userId -> weight) when strategy=custom",
      },
      resetPointer: {
        type: "boolean",
        description: "Also reset the round-robin pointer. Defaults to true.",
      },
    },
    required: ["teamId"],
  },
};

export async function handleRebalanceTeamComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1RebalanceTeam(args);
    const durationMs = Date.now() - start;
    logger.log({ tool: "rebalance_team", action: "execute", input: args, result, durationMs });

    if (!result.success) {
      return errorResponse(`${result.error?.message}\n\nRemediation: ${result.error?.remediation}`);
    }

    const lines = [
      ...result.actions_taken.map((a: string) => `✓ ${a}`),
    ];
    if (result.warnings?.length) {
      lines.push("", "Warnings:", ...result.warnings.map((w: string) => `⚠ ${w}`));
    }
    if (result.next_actions?.length) {
      lines.push("", "Suggested next:", ...result.next_actions.map((n: any) => `→ ${n.action}: ${n.reason}`));
    }
    return successResponse(lines.join("\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.log({ tool: "rebalance_team", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (update_team_weights, reset_team_pointer) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
