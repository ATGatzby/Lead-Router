import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const cloneModifyRuleCompositeTool = {
  name: "clone_modify_rule",
  description:
    "Clone an existing rule and apply modifications in one step. " +
    "PREFERRED over clone_rule + update_rule. " +
    "Creates the clone with your changes already applied.",
  inputSchema: {
    type: "object" as const,
    properties: {
      sourceRuleId: { type: "string", description: "ID of the rule to clone" },
      newName: { type: "string", description: "Name for the cloned rule" },
      modifications: {
        type: "object",
        description: "Changes to apply to the clone (conditions, branches, triggerEvent, etc.)",
      },
      activate: {
        type: "boolean",
        description: "Activate the cloned rule immediately. Defaults to false (created as INACTIVE).",
      },
    },
    required: ["sourceRuleId"],
  },
};

export async function handleCloneModifyRuleComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1CloneModifyRule(args);
    const durationMs = Date.now() - start;
    logger.log({ tool: "clone_modify_rule", action: "execute", input: args, result, durationMs });

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
    logger.log({ tool: "clone_modify_rule", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (clone_rule, update_rule) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
