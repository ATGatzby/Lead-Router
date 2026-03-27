import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const deleteRuleTool = {
  name: "delete_rule",
  description: "Delete a routing rule. First call without confirm to see what will be deleted, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ruleId: {
        type: "string",
        description: "The ID of the routing rule to delete",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the deletion. Defaults to false (preview only).",
      },
    },
    required: ["ruleId"],
  },
};

export async function handleDeleteRule(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { ruleId, confirm } = args;

  if (!confirm) {
    const rule = await web.getRule(ruleId);
    const lines = [
      "Will delete routing rule:",
      `  Name: ${rule.name}`,
      `  ID: ${ruleId}`,
      `  Object Type: ${rule.objectType}`,
      `  Status: ${rule.status}`,
      `  Priority: ${rule.priority ?? "—"}`,
    ];
    logger.log({ tool: "delete_rule", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  await web.deleteRule(ruleId);
  logger.log({ tool: "delete_rule", action: "execute", input: args, durationMs: Date.now() - start });
  return successResponse(`Rule ${ruleId} deleted successfully.`);
}
