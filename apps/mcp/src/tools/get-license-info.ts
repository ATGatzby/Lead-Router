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
  const result = await web.getLicenseInfo();
  logger.log({ tool: "get_license_info", action: "read", result, durationMs: Date.now() - start });

  const lines = ["License Information:"];
  if (result.plan) lines.push(`  Plan: ${result.plan}`);
  if (result.seatsPurchased !== undefined) lines.push(`  Seats Purchased: ${result.seatsPurchased}`);
  if (result.seatsUsed !== undefined) lines.push(`  Seats Used: ${result.seatsUsed}`);
  if (result.expiresAt) lines.push(`  Expires: ${result.expiresAt}`);
  if (result.features) lines.push(`  Features: ${JSON.stringify(result.features)}`);

  return successResponse(lines.join("\n"));
}
