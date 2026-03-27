import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const licenseUsersByProfileTool = {
  name: "license_users_by_profile",
  description: "License all users with a specific Salesforce profile. e.g., 'Standard User' licenses all Standard Users.",
  inputSchema: {
    type: "object" as const,
    properties: {
      profile: {
        type: "string",
        description: "The Salesforce profile name to match",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. Defaults to false (preview only).",
      },
    },
    required: ["profile"],
  },
};

export async function handleLicenseUsersByProfile(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { profile, confirm } = args;

  if (!confirm) {
    logger.log({ tool: "license_users_by_profile", action: "preview", input: { profile }, durationMs: Date.now() - start });
    return previewResponse(`Will license all users with Salesforce profile: ${profile}`);
  }

  const result = await web.licenseUsersByProfile(profile);
  logger.log({ tool: "license_users_by_profile", action: "execute", input: { profile }, result, durationMs: Date.now() - start });

  const lines = [`Licensed users with profile "${profile}".`];
  if (result.licensed !== undefined) lines.push(`Licensed: ${result.licensed}`);
  if (result.seatsUsed !== undefined) lines.push(`Seats used: ${result.seatsUsed}`);

  return successResponse(lines.join("\n"));
}
