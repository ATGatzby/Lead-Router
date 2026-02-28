import { Redis } from "ioredis";

// Singleton Redis client — reused across the engine process.
// BullMQ requires maxRetriesPerRequest: null.
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    _redis.on("error", (err: unknown) => {
      console.error("[Redis] connection error:", err);
    });
  }
  return _redis;
}

export const redis = getRedis();
