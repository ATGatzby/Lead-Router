import { Queue } from "bullmq";
import Redis from "ioredis";

// BullMQ requires maxRetriesPerRequest: null — use a dedicated connection
let _queueRedis: Redis | null = null;

function getQueueRedis(): Redis {
  if (!_queueRedis) {
    _queueRedis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    });
    _queueRedis.on("error", (err) => {
      console.error("[RoutingQueue/web] Redis error:", err);
    });
  }
  return _queueRedis;
}

export interface RetryJobData {
  logId: string;
  orgId: string;
  recordId: string;
  objectType: string; // Pascal-case for jsforce: "Lead" | "Contact" | "Account"
  ownerId: string;
}

let _queue: Queue<RetryJobData> | null = null;

export function getRoutingQueue(): Queue<RetryJobData> {
  if (!_queue) {
    _queue = new Queue<RetryJobData>("routing-retries", {
      connection: getQueueRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return _queue;
}

export function toPascalObjectType(objectType: string): string {
  const map: Record<string, string> = {
    LEAD: "Lead",
    CONTACT: "Contact",
    ACCOUNT: "Account",
  };
  return map[objectType] ?? objectType;
}
