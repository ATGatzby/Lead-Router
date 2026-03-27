import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";
import { formatUsersSummary } from "../utils/format.js";

export const listUsersTool = {
  name: "list_users",
  description: "List users in the system, optionally filtered by search query or license status",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Search query to filter users by name or email",
      },
      licensed: {
        type: "string",
        enum: ["true", "false"],
        description: "Filter by license status",
      },
    },
  },
};

export async function handleListUsers(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const data = await web.listUsers(args?.query, args?.licensed);
  const users = data.users || data;
  logger.log({ tool: "list_users", action: "read", input: args, durationMs: Date.now() - start });
  return successResponse(formatUsersSummary(users));
}
