import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const updateRuleTool = {
  name: "update_rule",
  description: "Update an existing routing rule. First call without confirm to see before/after diff, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ruleId: {
        type: "string",
        description: "The ID of the routing rule to update",
      },
      name: { type: "string", description: "New name" },
      status: { type: "string", description: "New status (ACTIVE, INACTIVE)" },
      priority: { type: "number", description: "New priority" },
      triggerEvent: { type: "string", description: "New trigger event" },
      conditions: {
        type: "array",
        description: "Replacement conditions array",
        items: { type: "object" },
      },
      branches: {
        type: "array",
        description: "Replacement branches array",
        items: { type: "object" },
      },
      matchConfig: {
        type: "object",
        description: "Matching/deduplication config. Set to configure lead-to-lead/contact/account matching. Set to null to remove. See create_rule for full schema.",
      },
      isDryRun: { type: "boolean", description: "If true, set rule to dry-run mode" },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the update. Defaults to false (preview only).",
      },
    },
    required: ["ruleId"],
  },
};

export async function handleUpdateRule(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { ruleId, confirm, ...updates } = args;

  if (!confirm) {
    const current = await web.getRule(ruleId);
    const lines = [`Will update rule: ${current.name} (${ruleId})`, "", "Changes:"];
    for (const [key, value] of Object.entries(updates)) {
      const before = (current as any)[key];
      const beforeStr = typeof before === "object" ? JSON.stringify(before) : String(before ?? "—");
      const afterStr = typeof value === "object" ? JSON.stringify(value) : String(value);
      lines.push(`  ${key}: ${beforeStr} -> ${afterStr}`);
    }
    logger.log({ tool: "update_rule", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.updateRule(ruleId, updates);
  logger.log({ tool: "update_rule", action: "execute", input: args, result, durationMs: Date.now() - start });
  return successResponse(`Rule updated successfully.\nID: ${result.id}\nName: ${result.name}`);
}
