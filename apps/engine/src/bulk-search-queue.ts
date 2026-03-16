import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { routeRecord, type RoutingPayload } from "./router.js";

// ─── Job type ─────────────────────────────────────────────────────────────

export interface BulkSearchJobData {
  orgId: string;
  ruleId: string;
  runId: string; // BulkSearchRun.id for tracking
  objectType: string; // "LEAD" | "CONTACT" | "ACCOUNT"
  records: Array<{
    recordId: string;
    fields: Record<string, unknown>;
    matchResult: {
      matchedType: string;
      matchedRecordId: string;
      ownerId: string;
      matchField: string;
    } | null;
  }>;
}

// ─── Module state ─────────────────────────────────────────────────────────

let _queue: Queue<BulkSearchJobData> | null = null;
let _worker: Worker<BulkSearchJobData> | null = null;
let _redis: Redis | null = null;

// ─── Exported queue accessor ──────────────────────────────────────────────

export function getBulkSearchQueue(): Queue<BulkSearchJobData> {
  if (!_queue) {
    throw new Error("Bulk search queue not initialized — call initBulkSearchQueue() first");
  }
  return _queue;
}

// For convenience (lazy access pattern used by enqueue callers)
export { _queue as bulkSearchQueue };

// ─── Init ─────────────────────────────────────────────────────────────────

export function initBulkSearchQueue(redisUrl: string): void {
  const redisOpts = parseRedisUrl(redisUrl);

  _redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  _redis.on("error", (err: unknown) => {
    console.error("[bulk-search-queue] Redis error:", err);
  });

  const QUEUE_NAME = "bulk-search-routing";

  _queue = new Queue<BulkSearchJobData>(QUEUE_NAME, {
    connection: _redis,
    defaultJobOptions: {
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 3000,
      },
    },
  });

  _worker = new Worker<BulkSearchJobData>(
    QUEUE_NAME,
    async (job: Job<BulkSearchJobData>) => {
      const { orgId, ruleId, runId, objectType, records } = job.data;
      let routed = 0;
      let failed = 0;

      for (const rec of records) {
        try {
          const payload: RoutingPayload = {
            orgId,
            objectType: objectType as RoutingPayload["objectType"],
            eventType: "SEARCH",
            recordId: rec.recordId,
            timestamp: new Date().toISOString(),
            fields: rec.fields,
            ruleId,
            preResolvedMatch: rec.matchResult
              ? {
                  type: rec.matchResult.matchedType,
                  ownerId: rec.matchResult.ownerId,
                  recordId: rec.matchResult.matchedRecordId,
                }
              : null,
          };

          const result = await routeRecord(payload, Date.now());
          if (result === "routed" || result === "merged") {
            routed++;
          } else {
            failed++;
          }
        } catch (err) {
          failed++;
          console.error(
            `[bulk-search-queue] Failed to route record ${rec.recordId}:`,
            err instanceof Error ? err.message : err
          );
        }
      }

      // Increment Redis counters for the run
      if (_redis) {
        const key = `bulk-run:${runId}`;
        if (routed > 0) await _redis.hincrby(key, "routed", routed);
        if (failed > 0) await _redis.hincrby(key, "failed", failed);
      }

      return { routed, failed };
    },
    {
      connection: _redis,
      concurrency: 15,
      limiter: {
        max: 30,
        duration: 1000,
      },
    }
  );

  _worker.on("failed", (job: Job<BulkSearchJobData> | undefined, err: Error) => {
    console.error(
      `[bulk-search-queue] Job ${job?.id ?? "unknown"} failed: ${err.message}`
    );
  });

  _worker.on("error", (err: Error) => {
    console.error("[bulk-search-queue] Worker error:", err);
  });

  console.log("[bulk-search-queue] Queue and worker initialized");
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "localhost",
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}
