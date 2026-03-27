import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getUserStatsTool = {
  name: "get_user_stats",
  description: "Get user statistics — total users, licensed count, seats used vs purchased.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleGetUserStats(web: WebClient, logger: Logger) {
  const start = Date.now();
  const data = await web.getUserStats();
  logger.log({ tool: "get_user_stats", action: "read", durationMs: Date.now() - start });

  const lines = [
    "User Statistics",
    `  Total Users: ${data.totalUsers ?? "—"}`,
    `  Licensed: ${data.licensedCount ?? "—"}`,
    `  Seats Used: ${data.seatsUsed ?? "—"}`,
    `  Seats Purchased: ${data.seatsPurchased ?? "—"}`,
  ];

  return successResponse(lines.join("\n"));
}
