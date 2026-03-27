import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const syncQueuesTool = {
  name: "sync_queues",
  description: "Sync Salesforce queues. Refreshes the available queues for routing assignment.",
  inputSchema: {
    type: "object" as const,
    properties: {
      confirm: {
        type: "boolean",
        description: "Set to true to execute the sync. Defaults to false (preview only).",
      },
    },
  },
};

export async function handleSyncQueues(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { confirm } = args || {};

  if (!confirm) {
    logger.log({ tool: "sync_queues", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse("Will sync Salesforce queues. This refreshes all available queues for routing assignment.");
  }

  const result = await web.syncQueues();
  logger.log({ tool: "sync_queues", action: "execute", result, durationMs: Date.now() - start });

  const lines = ["Queue sync completed."];
  if (result.synced !== undefined) lines.push(`Queues synced: ${result.synced}`);
  if (result.total !== undefined) lines.push(`Total: ${result.total}`);

  return successResponse(lines.join("\n"));
}
