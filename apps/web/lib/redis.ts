import Redis from "ioredis";

// Lightweight Redis client used by web-app management endpoints
// (e.g. reset-pointer). Routing-critical operations run in the engine.
let _redis: Redis | null = null;

export function getRedis(): Redis {
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      enableReadyCheck: false,
      lazyConnect: true,
    });
    _redis.on("error", (err) => {
      console.error("[Redis/web] connection error:", err);
    });
  }
  return _redis;
}
