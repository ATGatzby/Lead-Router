import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const retryRoutingTool = {
  name: "retry_routing",
  description: "Retry a failed routing operation. First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      logId: {
        type: "string",
        description: "The routing log ID to retry",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the retry. Defaults to false (preview only).",
      },
    },
    required: ["logId"],
  },
};

export async function handleRetryRouting(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { logId, confirm } = args;

  if (!confirm) {
    const lines = [
      "Will retry failed routing operation:",
      `  Log ID: ${logId}`,
    ];
    logger.log({ tool: "retry_routing", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.retryRouting(logId);
  logger.log({ tool: "retry_routing", action: "execute", input: args, durationMs: Date.now() - start });
  return successResponse(`Routing log ${logId} retried successfully.${result.status ? ` Status: ${result.status}` : ""}`);
}
