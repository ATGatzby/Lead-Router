import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const bulkLicenseUsersTool = {
  name: "bulk_license_users",
  description: "License multiple users at once. All specified users will be enabled to receive routed leads.",
  inputSchema: {
    type: "object" as const,
    properties: {
      userIds: {
        type: "array",
        items: { type: "string" },
        description: "Array of user IDs to license",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. Defaults to false (preview only).",
      },
    },
    required: ["userIds"],
  },
};

export async function handleBulkLicenseUsers(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { userIds, confirm } = args;

  if (!confirm) {
    logger.log({ tool: "bulk_license_users", action: "preview", input: { count: userIds.length }, durationMs: Date.now() - start });
    return previewResponse(`Will license ${userIds.length} user(s):\n  ${userIds.join("\n  ")}`);
  }

  const result = await web.bulkLicenseUsers(userIds);
  logger.log({ tool: "bulk_license_users", action: "execute", input: { count: userIds.length }, result, durationMs: Date.now() - start });

  const lines = [`${userIds.length} user(s) licensed successfully.`];
  if (result.licensed !== undefined) lines.push(`Licensed: ${result.licensed}`);
  if (result.seatsUsed !== undefined) lines.push(`Seats used: ${result.seatsUsed}`);
  if (result.failed?.length) lines.push(`Failed: ${result.failed.length}`);

  return successResponse(lines.join("\n"));
}
