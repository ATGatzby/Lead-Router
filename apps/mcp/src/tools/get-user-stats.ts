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
  const data = await web.getUserStats() as any;
  logger.log({ tool: "get_user_stats", action: "read", durationMs: Date.now() - start });

  const lines = [
    "User Statistics",
    `  Seats Purchased: ${data.seatsPurchased ?? "—"}`,
    `  Seats Used: ${data.seatsUsed ?? "—"}`,
  ];

  if (Array.isArray(data.breakdown)) {
    lines.push("\nBreakdown:");
    for (const b of data.breakdown) {
      lines.push(`  ${b.label || b.role || b.profile}: ${b.count ?? "—"}`);
    }
  }

  return successResponse(lines.join("\n"));
}
