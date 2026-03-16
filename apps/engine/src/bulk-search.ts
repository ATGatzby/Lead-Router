import { prisma } from "@lead-routing/db";
import { redis } from "./redis.js";
import { batchMatchRecords, type CachedMatchConfig, type BatchMatchResult } from "./batch-matcher.js";
import { Queue } from "bullmq";
import { EventEmitter } from "events";

// ─── Types ────────────────────────────────────────────────────────────────

export interface BulkSearchOptions {
  maxRecords?: number | null; // cap total records (null = unlimited)
  batchSize?: number;         // micro-batch size (default 500)
  runId: string;              // BulkSearchRun.id
}

export interface BulkSearchResult {
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "CANCELLED";
  recordsFound: number;
  recordsProcessed: number;
  recordsRouted: number;
  recordsFailed: number;
  durationMs: number;
  error?: string;
}

export interface BulkSearchJobData {
  orgId: string;
  ruleId: string;
  runId: string;
  objectType: string;
  records: Array<{
    recordId: string;
    fields: Record<string, unknown>;
    matchResult: BatchMatchResult | null;
  }>;
}

// Redis key helpers
const runKey = (runId: string) => `bulk-run:${runId}`;
const cancelKey = (runId: string) => `bulk-run:${runId}:cancel`;

// Back-pressure threshold: pause the stream when queue exceeds this many waiting jobs
const BACK_PRESSURE_THRESHOLD = 10_000;
const BACK_PRESSURE_CHECK_INTERVAL = 500; // ms

// ─── Queue accessor ──────────────────────────────────────────────────────

let _bulkSearchQueue: Queue<BulkSearchJobData> | null = null;

export function getBulkSearchQueue(): Queue<BulkSearchJobData> {
  if (!_bulkSearchQueue) {
    _bulkSearchQueue = new Queue<BulkSearchJobData>("bulk-search", {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return _bulkSearchQueue;
}

// Allow injecting a queue for testing
export function setBulkSearchQueue(queue: Queue<BulkSearchJobData>): void {
  _bulkSearchQueue = queue;
}

// ─── Main orchestrator ───────────────────────────────────────────────────

export async function runBulkSearch(
  conn: any, // jsforce Connection
  soql: string,
  ruleId: string,
  orgId: string,
  objectType: string,
  matchConfig: CachedMatchConfig | null,
  opts: BulkSearchOptions
): Promise<BulkSearchResult> {
  const startTime = Date.now();
  const batchSize = opts.batchSize || 500;
  const maxRecords = opts.maxRecords ?? null;
  const { runId } = opts;
  const queue = getBulkSearchQueue();

  try {
    // 1. Initialize Redis tracking hash
    await redis.hset(runKey(runId), {
      processed: "0",
      routed: "0",
      failed: "0",
      status: "RUNNING",
    });

    // 2. Start Bulk API 2.0 query — jsforce bulk2.query returns a Parsable (EventEmitter)
    const queryStream: EventEmitter = await conn.bulk2.query(soql);

    // 3. Collect all records from the stream.
    //    EventEmitter 'record' events fire synchronously, so async handlers
    //    cannot block between events. We collect first, then process in batches.
    const allRecords: Array<{ recordId: string; fields: Record<string, unknown> }> = [];

    await new Promise<void>((resolve, reject) => {
      queryStream.on("record", (record: Record<string, unknown>) => {
        const recordId = String(record["Id"] ?? record["id"] ?? "");
        if (!recordId) return;
        allRecords.push({ recordId, fields: record });
      });

      queryStream.on("end", () => resolve());
      queryStream.on("error", (err: Error) => reject(err));
    });

    // 4. Apply maxRecords cap
    const records = maxRecords !== null
      ? allRecords.slice(0, maxRecords)
      : allRecords;
    const totalFound = records.length;

    console.log(`[bulk-search] Collected ${totalFound} records for rule ${ruleId}`);

    // 5. Process records in micro-batches
    let totalEnqueued = 0;
    let cancelled = false;
    const jobIds: string[] = [];

    for (let i = 0; i < records.length; i += batchSize) {
      // Check cancel flag before each batch
      const cancelExists = await redis.exists(cancelKey(runId));
      if (cancelExists) {
        cancelled = true;
        break;
      }

      const batch = records.slice(i, i + batchSize);

      // Run batch matching if config is provided
      let matchResults = new Map<string, BatchMatchResult | null>();
      if (matchConfig) {
        matchResults = await batchMatchRecords(conn, batch, matchConfig);
      }

      // Build job data with records + match results
      const jobRecords = batch.map((r) => ({
        recordId: r.recordId,
        fields: r.fields,
        matchResult: matchResults.get(r.recordId) ?? null,
      }));

      const job = await queue.add("bulk-route-batch", {
        orgId,
        ruleId,
        runId,
        objectType,
        records: jobRecords,
      });

      if (job.id) jobIds.push(job.id);

      // Update Redis counters
      await redis.hincrby(runKey(runId), "processed", batch.length);
      totalEnqueued += batch.length;

      // Back-pressure: if queue is overloaded, wait for it to drain
      try {
        const waiting = await queue.getWaitingCount();
        if (waiting > BACK_PRESSURE_THRESHOLD) {
          while (true) {
            const w = await queue.getWaitingCount();
            if (w <= BACK_PRESSURE_THRESHOLD / 2) break;
            await new Promise((r) => setTimeout(r, BACK_PRESSURE_CHECK_INTERVAL));
          }
        }
      } catch {
        // Ignore back-pressure errors
      }
    }

    // 6. Wait for all enqueued jobs to complete (poll Redis counters)
    if (!cancelled && totalEnqueued > 0) {
      const maxWaitMs = 30 * 60 * 1000; // 30 min timeout
      const pollIntervalMs = 2000;
      const waitStart = Date.now();

      while (Date.now() - waitStart < maxWaitMs) {
        const [routedStr, failedStr] = await redis.hmget(runKey(runId), "routed", "failed");
        const routed = parseInt(routedStr ?? "0", 10);
        const failed = parseInt(failedStr ?? "0", 10);

        if (routed + failed >= totalEnqueued) break;

        // Check for cancellation while waiting
        const cancelExists = await redis.exists(cancelKey(runId));
        if (cancelExists) {
          cancelled = true;
          break;
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    }

    // 7. Read final counts from Redis
    const [processedStr, routedStr, failedStr] = await redis.hmget(
      runKey(runId),
      "processed",
      "routed",
      "failed"
    );

    const recordsProcessed = parseInt(processedStr ?? "0", 10);
    const recordsRouted = parseInt(routedStr ?? "0", 10);
    const recordsFailed = parseInt(failedStr ?? "0", 10);

    // Determine final status
    let status: BulkSearchResult["status"];
    if (cancelled) {
      status = "CANCELLED";
    } else if (recordsFailed === 0 && recordsRouted > 0) {
      status = "SUCCESS";
    } else if (recordsRouted > 0 && recordsFailed > 0) {
      status = "PARTIAL";
    } else if (recordsProcessed === 0) {
      status = "SUCCESS"; // No records found is still a success
    } else if (recordsFailed > 0 && recordsRouted === 0) {
      status = "FAILED";
    } else {
      status = "SUCCESS";
    }

    const durationMs = Date.now() - startTime;

    // 8. Update BulkSearchRun DB row
    await prisma.bulkSearchRun.update({
      where: { id: runId },
      data: {
        status: cancelled ? "CANCELLED" : status === "FAILED" ? "FAILED" : "COMPLETE",
        recordsFound: totalFound,
        recordsProcessed,
        recordsRouted,
        recordsFailed,
        completedAt: new Date(),
        durationMs,
      },
    });

    // 9. Clean up Redis keys
    await redis.del(runKey(runId), cancelKey(runId));

    return {
      status,
      recordsFound: totalFound,
      recordsProcessed,
      recordsRouted,
      recordsFailed,
      durationMs,
    };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.error(`[bulk-search] Error running bulk search for rule ${ruleId}:`, err);

    // Update DB row to FAILED
    try {
      await prisma.bulkSearchRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          error: err.message?.slice(0, 2000) ?? "Unknown error",
          completedAt: new Date(),
          durationMs,
        },
      });
    } catch (dbErr) {
      console.error("[bulk-search] Failed to update BulkSearchRun on error:", dbErr);
    }

    // Clean up Redis keys
    try {
      await redis.del(runKey(runId), cancelKey(runId));
    } catch {
      // Ignore cleanup errors
    }

    return {
      status: "FAILED",
      recordsFound: 0,
      recordsProcessed: 0,
      recordsRouted: 0,
      recordsFailed: 0,
      durationMs,
      error: err.message,
    };
  }
}

// ─── Cancel helper ───────────────────────────────────────────────────────

export async function cancelBulkSearch(runId: string): Promise<void> {
  await redis.set(cancelKey(runId), "1", "EX", 3600); // TTL 1 hour
}
