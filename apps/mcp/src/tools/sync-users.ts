import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const syncUsersTool = {
  name: "sync_users",
  description: "Sync users from Salesforce into the lead routing system. Upserts active users and deactivates removed ones.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleSyncUsers(web: WebClient, logger: Logger) {
  const start = Date.now();
  const result = await web.syncUsers();
  logger.log({ tool: "sync_users", action: "execute", result, durationMs: Date.now() - start });

  const lines = ["User sync completed."];
  if (result.upserted !== undefined) lines.push(`Upserted: ${result.upserted}`);
  if (result.deactivated !== undefined) lines.push(`Deactivated: ${result.deactivated}`);
  if (result.total !== undefined) lines.push(`Total: ${result.total}`);

  return successResponse(lines.join("\n"));
}
