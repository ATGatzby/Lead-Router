import { getRedis } from "./redis";

export const INVALIDATE_CHANNEL = "rules:invalidate";

/**
 * Publish a cache invalidation event to the engine.
 * The engine subscribes to this channel and reloads rules from DB.
 * Fails silently if Redis is unavailable.
 */
export async function invalidateRulesCache(
  orgId: string,
  objectType: string
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.publish(
      INVALIDATE_CHANNEL,
      JSON.stringify({ orgId, objectType })
    );
  } catch {
    // Non-critical: engine will use stale cache until restart or next invalidation
    console.warn("[cache] Failed to publish rules cache invalidation");
  }
}
