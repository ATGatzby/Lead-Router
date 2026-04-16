import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const syncFieldsTool = {
  name: "sync_fields",
  description: "Sync CRM field schemas for routing. Auto-detects CRM type (Salesforce or HubSpot) and syncs accordingly. Refreshes the available fields for use in routing rule conditions and field updates.",
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
    return previewResponse("Will sync CRM field schemas. Auto-detects Salesforce or HubSpot and refreshes all available fields for routing rule conditions and field updates.");
  }

  // Detect CRM type from license info
  let crmType = "SALESFORCE";
  try {
    const license = await web.getLicenseInfo() as any;
    if (license?.crmType) crmType = license.crmType;
  } catch {
    // Fall back to trying both
  }

  let result: any;
  if (crmType === "HUBSPOT") {
    result = await web.syncHubSpotFields();
  } else {
    result = await web.syncFields();
  }

  logger.log({ tool: "sync_fields", action: "execute", crmType, result, durationMs: Date.now() - start });

  const lines = [`Field sync completed (${crmType}).`];
  if (result.synced !== undefined) lines.push(`Fields synced: ${result.synced}`);
  if (result.total !== undefined) lines.push(`Total: ${result.total}`);
  if (result.counts) lines.push(`Counts: ${JSON.stringify(result.counts)}`);

  return successResponse(lines.join("\n"));
}
