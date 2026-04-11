import { Queue, Worker, type Job } from "bullmq";
import { redis } from "./redis.js";
import { prisma } from "@lead-routing/db";
import { updateOwner } from "@lead-routing/sfdc";
import { getOrgConnection, evictOrgConnection } from "./sfdc.js";
import { updateHubSpotRecordOwner, evictOrgHubSpotClient } from "./hubspot-connection.js";

const QUEUE_NAME = "routing-retries";

// ─── Job type ─────────────────────────────────────────────────────────────

export interface RetryJobData {
  logId: string;
  orgId: string;
  recordId: string;
  objectType: string; // 'LEAD' | 'CONTACT' | 'ACCOUNT' | 'COMPANY' | 'DEAL'
  ownerId: string;    // SFDC User/Queue ID or HubSpot Owner ID
}

// ─── Queue ────────────────────────────────────────────────────────────────

export const routingQueue = new Queue<RetryJobData>(QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000, // 2s → 8s → 32s
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Capitalise first letter: LEAD → Lead (for jsforce sobject names) */
function toSfdcObjectName(objectType: string): string {
  return objectType.charAt(0) + objectType.slice(1).toLowerCase();
}

/** Get the CRM type for an org from the database */
async function getOrgCrmType(orgId: string): Promise<string> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { crmType: true },
    });
    return org?.crmType ?? "SALESFORCE";
  } catch {
    return "SALESFORCE";
  }
}

// ─── Worker ───────────────────────────────────────────────────────────────

export const routingWorker = new Worker<RetryJobData>(
  QUEUE_NAME,
  async (job: Job<RetryJobData>) => {
    const { orgId, recordId, objectType, ownerId } = job.data;
    const crmType = await getOrgCrmType(orgId);

    if (crmType === "HUBSPOT") {
      await updateHubSpotRecordOwner(orgId, objectType, recordId, ownerId);
    } else {
      const conn = await getOrgConnection(orgId);
      await updateOwner(conn, toSfdcObjectName(objectType), recordId, ownerId);
    }
  },
  { connection: redis }
);

routingWorker.on("completed", async (job: Job<RetryJobData>) => {
  // Update log to SUCCESS once the retry succeeds
  await prisma.routingLog.update({
    where: { id: job.data.logId },
    data: { status: "SUCCESS", retryCount: job.attemptsMade },
  });

  // Increment routing quota for the org (retry succeeded = real routing)
  await prisma.organization.update({
    where: { id: job.data.orgId },
    data: { routingQuotaUsed: { increment: 1 } },
  });
});

routingWorker.on("failed", async (job: Job<RetryJobData> | undefined, err: Error) => {
  if (!job) return;

  // If the failure is an auth error, evict the cached connection/client so the next
  // retry (or next routing event) creates a fresh one with latest DB tokens.
  const msg = err.message ?? "";

  // SFDC auth errors
  if (msg.includes("invalid_grant") || msg.includes("expired") || msg.includes("INVALID_SESSION_ID")) {
    evictOrgConnection(job.data.orgId);
    console.warn(`[queue] Evicted stale SFDC connection for org ${job.data.orgId} (${msg})`);
  }

  // HubSpot auth errors
  if (msg.includes("401") || msg.includes("UNAUTHORIZED")) {
    evictOrgHubSpotClient(job.data.orgId);
    console.warn(`[queue] Evicted stale HubSpot client for org ${job.data.orgId} (${msg})`);
  }

  if (job.attemptsMade >= 3) {
    // All retries exhausted → mark as FAILED (DLQ)
    await prisma.routingLog.update({
      where: { id: job.data.logId },
      data: {
        status: "FAILED",
        errorMessage: err.message,
        retryCount: job.attemptsMade,
      },
    });
    console.error(
      `[queue] DLQ: routing log ${job.data.logId} marked FAILED after ${job.attemptsMade} attempts`
    );
  }
});

routingWorker.on("error", (err: Error) => {
  console.error("[queue] Worker error:", err);
});

export async function enqueueRetry(data: RetryJobData): Promise<void> {
  await routingQueue.add("sfdc-update", data);
}
