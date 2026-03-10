import type { FastifyRequest, FastifyReply } from "fastify";
import { redis } from "../redis.js";

/**
 * Rate limit middleware for engine endpoints.
 * Uses Redis INCR + EXPIRE sliding window.
 */
export async function engineRateLimit(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const body = request.body as { orgId?: string; sfdcOrgId?: string } | null;
  const orgId = body?.sfdcOrgId ?? body?.orgId ?? "unknown";
  const key = `rl:engine:route:${orgId}`;
  const limit = 100;
  const windowSeconds = 60;

  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }

  if (current > limit) {
    const ttl = await redis.ttl(key);
    reply.code(429).header("Retry-After", String(ttl > 0 ? ttl : windowSeconds)).send({
      error: "Too many requests",
      retryAfter: ttl > 0 ? ttl : windowSeconds,
    });
    return;
  }
}
