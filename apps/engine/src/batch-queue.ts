import { Queue, Worker, type Job } from "bullmq";
import { redis } from "./redis.js";
import { prisma } from "@lead-routing/db";
import { routeRecord, type RoutingPayload } from "./router.js";

const QUEUE_NAME = "routing-batch";

// ─── Job type ─────────────────────────────────────────────────────────────

export interface BatchJobData {
  orgId: string;
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  eventType: "INSERT" | "UPDATE" | "BOTH" | "SEARCH";
  recordId: string;
  timestamp: string;
  fields: Record<string, unknown>;
  batchId: string;
  ruleId?: string;
}

// ─── Queue ────────────────────────────────────────────────────────────────

export const batchQueue = new Queue<BatchJobData>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
});

// ─── Worker (10 concurrent jobs, rate-limited to 20/sec) ─────────────────

export const batchWorker = new Worker<BatchJobData>(
  QUEUE_NAME,
  async (job: Job<BatchJobData>) => {
    const { orgId, objectType, eventType, recordId, timestamp, fields, ruleId } = job.data;
    const payload: RoutingPayload = { orgId, objectType, eventType, recordId, timestamp, fields, ruleId };
    const result = await routeRecord(payload, Date.now());
    return result;
  },
  {
    connection: redis,
    concurrency: 10,
    limiter: {
      max: 20,
      duration: 1000,
    },
  }
);

// ─── Events ───────────────────────────────────────────────────────────────

batchWorker.on("completed", async (job: Job<BatchJobData>) => {
  const result = job.returnvalue;
  // Quota was pre-reserved by the batch endpoint. Decrement for non-routed results.
  if (result === "unmatched" || result === "dry_run") {
    await prisma.organization.update({
      where: { id: job.data.orgId },
      data: { routingQuotaUsed: { decrement: 1 } },
    });
  }
});

batchWorker.on("failed", async (job: Job<BatchJobData> | undefined, err: Error) => {
  if (!job) return;

  if (job.attemptsMade >= 3) {
    const { orgId, objectType, eventType, recordId, fields } = job.data;

    // All retries exhausted — decrement pre-reserved quota
    await prisma.organization.update({
      where: { id: orgId },
      data: { routingQuotaUsed: { decrement: 1 } },
    });

    // Create FAILED routing log so it appears in the dashboard
    await prisma.routingLog.create({
      data: {
        orgId,
        crmRecordId: recordId,
        objectType: objectType as any,
        eventType: eventType as any,
        status: "FAILED",
        errorMessage: `Routing failed after ${job.attemptsMade} attempts: ${err.message}`,
        retryCount: job.attemptsMade,
        recordSnapshot: fields as any,
      },
    });

    console.error(
      `[batch-queue] DLQ: record ${recordId} failed after ${job.attemptsMade} attempts: ${err.message}`
    );
  }
});

batchWorker.on("error", (err: Error) => {
  console.error("[batch-queue] Worker error:", err);
});

// ─── Enqueue helper ───────────────────────────────────────────────────────

export async function enqueueBatchJobs(jobs: BatchJobData[]): Promise<void> {
  const bulkJobs = jobs.map((data) => ({
    name: "route-record",
    data,
  }));
  await batchQueue.addBulk(bulkJobs);
}
