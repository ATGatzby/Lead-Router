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

/**
 * Bulk idempotency check via Redis pipeline (single round-trip for N keys).
 * Returns a Map of recordId → isNew (true = should process, false = duplicate).
 */
export async function claimIdempotencyKeys(
  orgId: string,
  records: Array<{ recordId: string; eventType: string; timestamp: string }>
): Promise<Map<string, boolean>> {
  const pipeline = redis.pipeline();

  for (const r of records) {
    const key = `idem:${orgId}:${r.recordId}:${r.eventType}:${r.timestamp}`;
    pipeline.set(key, "1", "NX", "EX", TTL_SECONDS);
  }

  const results = await pipeline.exec();
  const map = new Map<string, boolean>();

  for (let i = 0; i < records.length; i++) {
    const isNew = results?.[i]?.[1] === "OK";
    map.set(records[i].recordId, isNew);
  }

  return map;
}
