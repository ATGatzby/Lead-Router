import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getSfdcStatusTool = {
  name: "get_sfdc_status",
  description: "Check the Salesforce connection status — whether OAuth is connected, last sync time, and package deployment status.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleGetSfdcStatus(web: WebClient, logger: Logger) {
  const start = Date.now();
  const result = await web.getSfdcStatus();
  logger.log({ tool: "get_sfdc_status", action: "read", result, durationMs: Date.now() - start });

  const lines = ["Salesforce Connection Status:"];
  if (result.connected !== undefined) lines.push(`  Connected: ${result.connected}`);
  if (result.orgId) lines.push(`  Org ID: ${result.orgId}`);
  if (result.instanceUrl) lines.push(`  Instance URL: ${result.instanceUrl}`);
  if (result.lastSync) lines.push(`  Last Sync: ${result.lastSync}`);
  if (result.packageDeployed !== undefined) lines.push(`  Package Deployed: ${result.packageDeployed}`);

  return successResponse(lines.join("\n"));
}
