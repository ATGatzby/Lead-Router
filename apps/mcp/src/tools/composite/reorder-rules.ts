import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const reorderRulesCompositeTool = {
  name: "reorder_rules_composite",
  description:
    "Reorder routing rules by priority with validation. " +
    "PREFERRED over reorder_rules — validates rule IDs exist and shows before/after order. " +
    "Can move a single rule or reorder all rules at once.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ruleIds: {
        type: "array",
        items: { type: "string" },
        description: "Ordered array of rule IDs (first = highest priority)",
      },
      moveRuleId: { type: "string", description: "Single rule to move (alternative to full reorder)" },
      position: {
        type: "number",
        description: "New position for the moved rule (1-based)",
      },
    },
  },
};

export async function handleReorderRulesComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1ReorderRules(args || {});
    const durationMs = Date.now() - start;
    logger.log({ tool: "reorder_rules_composite", action: "execute", input: args, result, durationMs });

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
    logger.log({ tool: "reorder_rules_composite", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tool (reorder_rules) which works with your current token."
      );
    }
    return errorResponse(msg);
  }
}
