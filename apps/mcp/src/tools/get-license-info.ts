import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getLicenseInfoTool = {
  name: "get_license_info",
  description: "Get current license information — plan tier, seats purchased, seats used, feature limits.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleGetLicenseInfo(web: WebClient, logger: Logger) {
  const start = Date.now();
  const result = await web.getLicenseInfo() as any;
  logger.log({ tool: "get_license_info", action: "read", result, durationMs: Date.now() - start });

  const lines = ["License Information:"];
  if (result.tier) lines.push(`  Tier: ${result.tier}`);
  if (result.licenseKey) lines.push(`  License Key: ${result.licenseKey}`);
  if (result.validUntil) lines.push(`  Valid Until: ${result.validUntil}`);
  if (result.crmType) lines.push(`  CRM Type: ${result.crmType}`);
  if (result.limits) lines.push(`  Limits: ${JSON.stringify(result.limits)}`);
  if (result.usage) lines.push(`  Usage: ${JSON.stringify(result.usage)}`);

  return successResponse(lines.join("\n"));
}
