import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const reorderRulesTool = {
  name: "reorder_rules",
  description: "Reorder routing rules by priority. Pass rule IDs in the desired evaluation order (first = highest priority). First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ruleIds: {
        type: "array",
        items: { type: "string" },
        description: "Array of rule IDs in the desired priority order (first = highest priority)",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the reorder. Defaults to false (preview only).",
      },
    },
    required: ["ruleIds"],
  },
};

export async function handleReorderRules(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { ruleIds, confirm } = args;

  if (!confirm) {
    const lines = [
      "Will reorder routing rules:",
      `  ${ruleIds.length} rule(s) in new priority order:`,
    ];
    for (let i = 0; i < ruleIds.length; i++) {
      lines.push(`    ${i + 1}. ${ruleIds[i]}`);
    }
    logger.log({ tool: "reorder_rules", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.reorderRules(ruleIds);
  logger.log({ tool: "reorder_rules", action: "execute", input: args, result, durationMs: Date.now() - start });
  return successResponse(`Rules reordered successfully. ${ruleIds.length} rule(s) updated.`);
}
