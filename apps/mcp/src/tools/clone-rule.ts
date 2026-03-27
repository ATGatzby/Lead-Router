import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const cloneRuleTool = {
  name: "clone_rule",
  description: "Clone an existing routing rule. Creates a copy with all conditions and branches. First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ruleId: {
        type: "string",
        description: "The ID of the routing rule to clone",
      },
      newName: {
        type: "string",
        description: "Optional name for the cloned rule. Defaults to 'Copy of <original name>'.",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the clone. Defaults to false (preview only).",
      },
    },
    required: ["ruleId"],
  },
};

export async function handleCloneRule(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { ruleId, newName, confirm } = args;

  if (!confirm) {
    const rule = await web.getRule(ruleId);
    const lines = [
      "Will clone routing rule:",
      `  Source: ${rule.name} (${ruleId})`,
      `  New Name: ${newName || `Copy of ${rule.name}`}`,
      `  Object Type: ${rule.objectType}`,
      `  Trigger Event: ${rule.triggerEvent}`,
    ];
    logger.log({ tool: "clone_rule", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const data: Record<string, unknown> = {};
  if (newName) data.name = newName;
  const result = await web.cloneRule(ruleId, data);
  const rule = result.rule || result;
  logger.log({ tool: "clone_rule", action: "execute", input: args, result, durationMs: Date.now() - start });
  return successResponse(`Rule cloned successfully.\nNew ID: ${rule.id}\nName: ${rule.name}`);
}
