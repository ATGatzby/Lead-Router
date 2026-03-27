import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const retryAllFailedTool = {
  name: "retry_all_failed",
  description: "Retry all failed routing operations. First call without confirm to preview, then call with confirm: true to execute.",
  inputSchema: {
    type: "object" as const,
    properties: {
      confirm: {
        type: "boolean",
        description: "Set to true to execute the retry. Defaults to false (preview only).",
      },
    },
  },
};

export async function handleRetryAllFailed(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();

  if (!args?.confirm) {
    const lines = [
      "Will retry ALL failed routing operations.",
      "This may take a while depending on the number of failures.",
    ];
    logger.log({ tool: "retry_all_failed", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse(lines.join("\n"));
  }

  const result = await web.retryAllFailed();
  logger.log({ tool: "retry_all_failed", action: "execute", input: args, durationMs: Date.now() - start });
  return successResponse(`All failed routing operations retried.${result.count !== undefined ? ` ${result.count} operations retried.` : ""}`);
}
