import { getRedis } from "./redis";

function suspendedKey(orgId: string): string {
  return `org:suspended:${orgId}`;
}

/**
 * Returns true if the org is suspended (Redis key present).
 * Fails open (returns false) if Redis is unavailable.
 */
export async function isOrgSuspended(orgId: string): Promise<boolean> {
  try {
    const redis = getRedis();
    const value = await redis.get(suspendedKey(orgId));
    return value === "1";
  } catch {
    return false; // fail open — don't block legitimate users on Redis hiccup
  }
}

export async function setOrgSuspended(orgId: string): Promise<void> {
  const redis = getRedis();
  await redis.set(suspendedKey(orgId), "1");
}

export async function clearOrgSuspended(orgId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(suspendedKey(orgId));
}
