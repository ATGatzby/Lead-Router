import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const cancelBulkRunTool = {
  name: "cancel_bulk_run",
  description: "Cancel a running bulk search/route operation.",
  inputSchema: {
    type: "object" as const,
    properties: {
      runId: {
        type: "string",
        description: "The bulk run ID to cancel",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute the cancellation. Defaults to false (preview only).",
      },
    },
    required: ["runId"],
  },
};

export async function handleCancelBulkRun(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { runId, confirm } = args;

  if (!confirm) {
    logger.log({ tool: "cancel_bulk_run", action: "preview", input: { runId }, durationMs: Date.now() - start });
    return previewResponse(`Will cancel bulk run: ${runId}`);
  }

  const result = await web.cancelBulkRun(runId);
  logger.log({ tool: "cancel_bulk_run", action: "execute", input: { runId }, result, durationMs: Date.now() - start });
  return successResponse(`Bulk run ${runId} cancelled successfully.`);
}
