import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const updateRuleCriteriaCompositeTool = {
  name: "update_rule_criteria",
  description:
    "Update a rule's conditions and branch criteria in one step. " +
    "PREFERRED over update_rule when you only need to change filter conditions. " +
    "Validates conditions against available CRM fields before applying.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ruleId: { type: "string", description: "Rule ID to update" },
      conditions: {
        type: "array",
        items: { type: "object" },
        description: "New entry conditions (replaces existing)",
      },
      branchConditions: {
        type: "object",
        description: "Branch-level condition updates (branchId -> conditions array)",
      },
      mode: {
        type: "string",
        enum: ["replace", "append"],
        description: "Whether to replace or append conditions. Defaults to replace.",
      },
    },
    required: ["ruleId"],
  },
};

export async function handleUpdateRuleCriteriaComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1UpdateRuleCriteria(args);
    const durationMs = Date.now() - start;
    logger.log({ tool: "update_rule_criteria", action: "execute", input: args, result, durationMs });

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
    logger.log({ tool: "update_rule_criteria", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tool (update_rule) which works with your current token."
      );
    }
    return errorResponse(msg);
  }
}
