import { Queue, Worker } from "bullmq";
import { prisma } from "@lead-routing/db";
import { runScheduledRoute } from "./search-runner.js";

let schedulerQueue: Queue | null = null;
let schedulerWorker: Worker | null = null;

/**
 * Initialize the scheduler queue and worker.
 * Call once on engine startup after Redis is available.
 */
export function initScheduler(redisUrl: string): void {
  const connection = parseRedisConnection(redisUrl);

  schedulerQueue = new Queue("route-scheduler", { connection });

  schedulerWorker = new Worker(
    "route-scheduler",
    async (job) => {
      const { ruleId, orgId } = job.data as { ruleId: string; orgId: string };
      console.log(`[scheduler] Running scheduled route ${ruleId} for org ${orgId}`);
      const result = await runScheduledRoute(ruleId, orgId);
      console.log(`[scheduler] Result for ${ruleId}:`, result.status, `${result.recordsRouted ?? 0} routed`);
      return result;
    },
    { connection, concurrency: 3 }
  );

  schedulerWorker.on("failed", (job, err) => {
    console.error(`[scheduler] Job ${job?.id} failed:`, err.message);
  });

  console.log("[scheduler] Initialized route-scheduler queue and worker");
}

/**
 * Sync BullMQ repeatable jobs with active scheduled rules.
 * - Upserts repeatable jobs for active rules with a cron schedule
 * - Removes jobs for rules that are inactive or deleted
 * Call on startup + on cache invalidation.
 */
export async function syncScheduledJobs(orgId?: string): Promise<void> {
  if (!schedulerQueue) {
    console.warn("[scheduler] Queue not initialized — skipping sync");
    return;
  }

  // Load all active scheduled rules (optionally filtered by org)
  const where: any = { status: "ACTIVE", routeType: "SCHEDULED" };
  if (orgId) where.orgId = orgId;

  const rules = await prisma.routingRule.findMany({
    where,
    select: { id: true, orgId: true, scheduleCron: true, status: true },
  } as any);

  const activeJobKeys = new Set<string>();

  // Upsert repeatable jobs for rules with a cron schedule
  for (const rule of rules as any[]) {
    if (rule.scheduleCron) {
      const jobKey = `route-${rule.id}`;
      activeJobKeys.add(jobKey);

      await schedulerQueue.upsertJobScheduler(
        jobKey,
        { pattern: rule.scheduleCron },
        { name: `scheduled-route-${rule.id}`, data: { ruleId: rule.id, orgId: rule.orgId } }
      );
      console.log(`[scheduler] Upserted job ${jobKey} with cron ${rule.scheduleCron}`);
    }
  }

  // Remove stale jobs (rules that are no longer active/scheduled)
  const existingSchedulers = await schedulerQueue.getJobSchedulers();
  for (const scheduler of existingSchedulers) {
    // Only manage jobs we created (prefixed with "route-")
    if (scheduler.key.startsWith("route-") && !activeJobKeys.has(scheduler.key)) {
      await schedulerQueue.removeJobScheduler(scheduler.key);
      console.log(`[scheduler] Removed stale job ${scheduler.key}`);
    }
  }
}

/** Parse Redis URL into BullMQ connection options */
function parseRedisConnection(redisUrl: string) {
  try {
    const url = new URL(redisUrl);
    return {
      host: url.hostname,
      port: Number(url.port) || 6379,
      password: url.password || undefined,
      maxRetriesPerRequest: null as null,
    };
  } catch {
    return { host: "localhost", port: 6379, maxRetriesPerRequest: null as null };
  }
}
