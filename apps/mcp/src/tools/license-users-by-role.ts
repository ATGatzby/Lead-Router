import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const licenseUsersByRoleTool = {
  name: "license_users_by_role",
  description: "License all users with a specific Salesforce role. e.g., 'Sales Rep' licenses all Sales Reps.",
  inputSchema: {
    type: "object" as const,
    properties: {
      role: {
        type: "string",
        description: "The Salesforce role name to match",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. Defaults to false (preview only).",
      },
    },
    required: ["role"],
  },
};

export async function handleLicenseUsersByRole(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { role, confirm } = args;

  if (!confirm) {
    logger.log({ tool: "license_users_by_role", action: "preview", input: { role }, durationMs: Date.now() - start });
    return previewResponse(`Will license all users with Salesforce role: ${role}`);
  }

  const result = await web.licenseUsersByRole(role);
  logger.log({ tool: "license_users_by_role", action: "execute", input: { role }, result, durationMs: Date.now() - start });

  const lines = [`Licensed users with role "${role}".`];
  if (result.licensed !== undefined) lines.push(`Licensed: ${result.licensed}`);
  if (result.seatsUsed !== undefined) lines.push(`Seats used: ${result.seatsUsed}`);

  return successResponse(lines.join("\n"));
}
