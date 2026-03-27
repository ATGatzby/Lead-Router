import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const updateUserLicenseTool = {
  name: "update_user_license",
  description: "License or unlicense a user. Licensing enables a user to receive routed leads. Unlicensing removes them from all round-robin teams.",
  inputSchema: {
    type: "object" as const,
    properties: {
      userId: {
        type: "string",
        description: "The user's ID (from list_users output)",
      },
      licensed: {
        type: "boolean",
        description: "true to license the user, false to unlicense",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. Default false shows a preview.",
      },
    },
    required: ["userId", "licensed"],
  },
};

export async function handleUpdateUserLicense(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { userId, licensed, confirm } = args;

  if (!confirm) {
    const action = licensed ? "LICENSE" : "UNLICENSE";
    const warning = licensed
      ? "This will enable the user to receive routed leads."
      : "This will remove the user from all active round-robin teams.";
    logger.log({ tool: "update_user_license", action: "preview", input: { userId, licensed }, durationMs: Date.now() - start });
    return previewResponse(`Action: ${action} user ${userId}\n${warning}`);
  }

  const result = licensed
    ? await web.licenseUser(userId)
    : await web.delicenseUser(userId);

  const durationMs = Date.now() - start;
  logger.log({ tool: "update_user_license", action: "execute", input: { userId, licensed }, result, durationMs });

  if (licensed) {
    return successResponse(`User licensed successfully. Seats used: ${result.seatsUsed ?? "unknown"}`);
  } else {
    const teams = result.removedFromTeams?.length
      ? `\nRemoved from teams: ${result.removedFromTeams.join(", ")}`
      : "";
    return successResponse(`User unlicensed successfully.${teams}`);
  }
}
