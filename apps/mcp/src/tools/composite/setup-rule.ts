import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const setupRuleCompositeTool = {
  name: "setup_routing_rule",
  description:
    "Create a complete routing rule with conditions, branches, and team assignment in one step. " +
    "PREFERRED over the multi-step sequence of create_rule + update_rule. " +
    "Supports all object types (Lead, Contact, Account, Company, Deal).",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "Rule name" },
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT", "COMPANY", "DEAL"],
        description: "CRM object type this rule applies to",
      },
      triggerEvent: {
        type: "string",
        enum: ["INSERT", "UPDATE", "BOTH"],
        description: "When this rule fires",
      },
      conditions: {
        type: "array",
        items: { type: "object" },
        description: "Entry conditions (field, operator, value)",
      },
      branches: {
        type: "array",
        items: { type: "object" },
        description: "Routing branches with assignment targets",
      },
      teamId: { type: "string", description: "Default team to assign to" },
      priority: { type: "number", description: "Rule priority (lower = higher priority)" },
    },
    required: ["name", "objectType"],
  },
};

export async function handleSetupRuleComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1SetupRoutingRule(args);
    const durationMs = Date.now() - start;
    logger.log({ tool: "setup_routing_rule", action: "execute", input: args, result, durationMs });

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
    logger.log({ tool: "setup_routing_rule", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (create_rule, update_rule) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
