import { rateLimit } from "./rate-limit";

// Per-token rate limits by action category
const RATE_LIMITS = {
  read: { limit: 120, window: 60 },   // 120 reads/min
  write: { limit: 30, window: 60 },   // 30 writes/min
  bulk: { limit: 5, window: 60 },     // 5 bulk ops/min
};

const READ_ACTIONS = ["get-routing-status", "get-performance", "get-team-workload"];
const BULK_ACTIONS = ["bulk-route", "export-report"];
// Everything else is "write"

function getCategory(actionSlug: string): keyof typeof RATE_LIMITS {
  if (READ_ACTIONS.includes(actionSlug)) return "read";
  if (BULK_ACTIONS.includes(actionSlug)) return "bulk";
  return "write";
}

export async function checkV1RateLimit(
  tokenId: string,
  actionSlug: string,
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds?: number }> {
  const category = getCategory(actionSlug);
  const { limit, window } = RATE_LIMITS[category];
  const key = `rl:v1:${category}:${tokenId}`;
  return rateLimit(key, limit, window);
}
