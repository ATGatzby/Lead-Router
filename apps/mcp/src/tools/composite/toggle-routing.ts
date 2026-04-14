import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const toggleRoutingCompositeTool = {
  name: "toggle_routing",
  description:
    "Enable or disable routing for specific rules or globally. " +
    "PREFERRED over individual update_rule status toggles. " +
    "Can pause/resume routing by rule, object type, or everything.",
  inputSchema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["enable", "disable"],
        description: "Whether to enable or disable routing",
      },
      scope: {
        type: "string",
        enum: ["all", "rule", "object_type"],
        description: "What to toggle. 'all' affects all rules.",
      },
      ruleId: { type: "string", description: "Rule ID to toggle (when scope=rule)" },
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT", "COMPANY", "DEAL"],
        description: "Object type to toggle (when scope=object_type)",
      },
    },
    required: ["action"],
  },
};

export async function handleToggleRoutingComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1ToggleRouting(args);
    const durationMs = Date.now() - start;
    logger.log({ tool: "toggle_routing", action: "execute", input: args, result, durationMs });

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
    logger.log({ tool: "toggle_routing", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (update_rule, set_routing_mode) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
