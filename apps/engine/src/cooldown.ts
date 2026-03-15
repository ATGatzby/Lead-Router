import { redis } from "./redis.js";

const DEFAULT_TTL_SECONDS = 30;

function cooldownKey(orgId: string, recordId: string): string {
  return `cooldown:${orgId}:${recordId}`;
}

/**
 * Set a cooldown key after routing a record.
 * Prevents recursive trigger loops when the engine's ownership update
 * fires another UPDATE event back from Salesforce.
 */
export async function setCooldown(
  orgId: string,
  recordId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  try {
    const key = cooldownKey(orgId, recordId);
    await redis.set(key, "1", "EX", ttlSeconds);
  } catch (err) {
    console.error("[cooldown] Failed to set cooldown:", err);
  }
}

/**
 * Check whether a record is in cooldown.
 * Returns false if Redis is unavailable (fail-open).
 */
export async function isInCooldown(
  orgId: string,
  recordId: string,
): Promise<boolean> {
  try {
    const key = cooldownKey(orgId, recordId);
    const result = await redis.exists(key);
    return result === 1;
  } catch (err) {
    console.error("[cooldown] Failed to check cooldown:", err);
    return false;
  }
}
