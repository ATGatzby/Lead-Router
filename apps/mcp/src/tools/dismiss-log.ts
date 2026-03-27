import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const dismissLogTool = {
  name: "dismiss_log",
  description: "Dismiss a routing log entry (mark as reviewed/acknowledged). First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      logId: {
        type: "string",
        description: "The routing log ID to dismiss",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the dismissal. Defaults to false (preview only).",
      },
    },
    required: ["logId"],
  },
};

export async function handleDismissLog(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { logId, confirm } = args;

  if (!confirm) {
    const lines = [
      "Will dismiss routing log entry:",
      `  Log ID: ${logId}`,
    ];
    logger.log({ tool: "dismiss_log", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  await web.dismissLog(logId);
  logger.log({ tool: "dismiss_log", action: "execute", input: args, durationMs: Date.now() - start });
  return successResponse(`Routing log ${logId} dismissed successfully.`);
}
