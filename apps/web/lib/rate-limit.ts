import { getRedis } from "./redis";

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
}

/**
 * Sliding-window rate limiter using Redis INCR + EXPIRE.
 * @param key - Unique key (e.g., `rl:login:${ip}`)
 * @param limit - Max requests per window
 * @param windowSeconds - Window size in seconds
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const redis = getRedis();
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }

  if (current > limit) {
    const ttl = await redis.ttl(key);
    return { allowed: false, remaining: 0, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  }

  return { allowed: true, remaining: limit - current };
}
