import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const syncFieldsTool = {
  name: "sync_fields",
  description: "Sync Salesforce field schemas. Refreshes the available fields for use in routing rule conditions.",
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

export async function handleSyncFields(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { confirm } = args || {};

  if (!confirm) {
    logger.log({ tool: "sync_fields", action: "preview", input: args, durationMs: Date.now() - start });
    return previewResponse("Will sync Salesforce field schemas. This refreshes all available fields for routing rule conditions.");
  }

  const result = await web.syncFields();
  logger.log({ tool: "sync_fields", action: "execute", result, durationMs: Date.now() - start });

  const lines = ["Field sync completed."];
  if (result.synced !== undefined) lines.push(`Fields synced: ${result.synced}`);
  if (result.total !== undefined) lines.push(`Total: ${result.total}`);

  return successResponse(lines.join("\n"));
}
