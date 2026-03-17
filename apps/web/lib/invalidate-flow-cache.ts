import { getRedis } from "./redis";

export const FLOW_INVALIDATE_CHANNEL = "flows:invalidate";

/**
 * Publish a cache invalidation event to the engine.
 * The engine subscribes to this channel and reloads flows from DB.
 * Fails silently if Redis is unavailable.
 */
export async function invalidateFlowCache(
  orgId: string,
  objectType: string
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.publish(
      FLOW_INVALIDATE_CHANNEL,
      JSON.stringify({ orgId, objectType })
    );
  } catch {
    // Non-critical: engine will use stale cache until restart or next invalidation
    console.warn("[cache] Failed to publish flow cache invalidation");
  }
}
