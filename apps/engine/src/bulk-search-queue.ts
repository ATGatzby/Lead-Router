import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@lead-routing/db";
import { bulkUpdateOwners, type BulkUpdateRecord } from "@lead-routing/sfdc";
import { routeRecord, type RoutingPayload } from "./router.js";
import { getOrgConnection } from "./sfdc.js";

// ─── Job type ─────────────────────────────────────────────────────────────

export interface BulkSearchJobData {
  orgId: string;
  ruleId: string;
  runId: string; // BulkSearchRun.id for tracking
  objectType: string; // "LEAD" | "CONTACT" | "ACCOUNT"
  simulate?: boolean; // Skip routing + SFDC write, just count records
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

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Capitalise first letter only: LEAD → Lead */
function toSfdcObjectName(objectType: string): string {
  return objectType.charAt(0) + objectType.slice(1).toLowerCase();
}

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
      const { orgId, ruleId, runId, objectType, records, simulate } = job.data;

      // ── Simulation mode: skip routing + SFDC, just count records ──────
      if (simulate) {
        const count = records.length;
        // Simulate ~50μs per record processing time
        await new Promise((resolve) => setTimeout(resolve, count * 0.05));
        if (_redis) {
          await _redis.hincrby(`bulk-run:${runId}`, "routed", count);
        }
        return { routed: count, failed: 0 };
      }

      // ── Phase A: Collect routing decisions ────────────────────────────
      const assignments: Array<{ recordId: string; ownerId: string; logId: string }> = [];
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
            skipSfdcWrite: true,
            _assignments: assignments,
          };

          await routeRecord(payload, Date.now());
        } catch (err) {
          console.error(
            `[bulk-search-queue] Route error for ${rec.recordId}:`,
            err instanceof Error ? err.message : err
          );
          failed++;
        }
      }

      // ── Phase B: Bulk write all assignments ───────────────────────────
      if (assignments.length > 0) {
        // Set phase in Redis
        if (_redis) {
          await _redis.hset(`bulk-run:${runId}`, "phase", "writing");
        }

        try {
          const conn = await getOrgConnection(orgId);
          const timestamp = new Date().toISOString();
          const sfdcObjectName = toSfdcObjectName(objectType);
          const updateRecords: BulkUpdateRecord[] = assignments.map((a) => ({
            Id: a.recordId,
            OwnerId: a.ownerId,
          }));

          const result = await bulkUpdateOwners(
            conn,
            sfdcObjectName,
            updateRecords,
            "lrt__Routing_Action__c"
          );

          // Reconcile: update routing logs based on write results
          if (result.successful.length > 0) {
            const successLogIds = assignments
              .filter((a) => result.successful.includes(a.recordId))
              .map((a) => a.logId);
            if (successLogIds.length > 0) {
              await prisma.routingLog.updateMany({
                where: { id: { in: successLogIds } },
                data: { status: "SUCCESS" },
              });
            }
            routed += result.successful.length;
          }

          if (result.failed.length > 0) {
            const failLogIds = assignments
              .filter((a) => result.failed.some((f) => f.id === a.recordId))
              .map((a) => a.logId);
            if (failLogIds.length > 0) {
              await prisma.routingLog.updateMany({
                where: { id: { in: failLogIds } },
                data: { status: "FAILED", errorMessage: "Bulk API write failed" },
              });
            }
            failed += result.failed.length;
          }

          // Count unprocessed as failed
          if (result.unprocessed > 0) {
            failed += result.unprocessed;
          }
        } catch (err: any) {
          console.error(
            `[bulk-search-queue] Bulk write failed for batch:`,
            err.message
          );
          // Mark ALL assignments as failed
          const allLogIds = assignments.map((a) => a.logId);
          if (allLogIds.length > 0) {
            await prisma.routingLog.updateMany({
              where: { id: { in: allLogIds } },
              data: { status: "FAILED", errorMessage: `Bulk write error: ${err.message}` },
            });
          }
          failed += assignments.length;
        }
      }

      // ── Phase C: Update Redis counters ────────────────────────────────
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
