import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const runScheduledRuleTool = {
  name: "run_scheduled_rule",
  description: "Trigger a manual run of a scheduled routing rule. Executes the rule's search criteria and routes matching records. First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ruleId: {
        type: "string",
        description: "The ID of the scheduled routing rule to run",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the run. Defaults to false (preview only).",
      },
    },
    required: ["ruleId"],
  },
};

export async function handleRunScheduledRule(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { ruleId, confirm } = args;

  if (!confirm) {
    const rule = await web.getRule(ruleId);
    const lines = [
      "Will trigger manual run of scheduled rule:",
      `  Name: ${rule.name} (${ruleId})`,
      `  Object Type: ${rule.objectType}`,
      `  Status: ${rule.status}`,
    ];
    logger.log({ tool: "run_scheduled_rule", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.runScheduledRule(ruleId);
  const run = result.run || result;
  logger.log({ tool: "run_scheduled_rule", action: "execute", input: args, result, durationMs: Date.now() - start });
  return successResponse(`Scheduled rule ${ruleId} triggered successfully.\nRun ID: ${run.id || "started"}\nStatus: ${run.status || "RUNNING"}`);
}
