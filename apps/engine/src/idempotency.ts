import { redis } from "./redis.js";

const TTL_SECONDS = 3600; // 1 hour

/**
 * Attempt to claim an idempotency key.
 * Returns true if this event is new and should be processed.
 * Returns false if it's a duplicate and should be skipped.
 */
export async function claimIdempotencyKey(
  orgId: string,
  recordId: string,
  eventType: string,
  timestamp: string
): Promise<boolean> {
  const key = `idem:${orgId}:${recordId}:${eventType}:${timestamp}`;
  // SET key 1 NX EX ttl — returns "OK" if set (new), null if already exists
  const result = await redis.set(key, "1", "NX", "EX", TTL_SECONDS);
  return result === "OK";
}
