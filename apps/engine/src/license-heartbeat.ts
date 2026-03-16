import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { hostname } from "os";

const QUEUE_NAME = "license-heartbeat";
const REDIS_KEY = "license:heartbeat:latest";

let heartbeatQueue: Queue | null = null;
let heartbeatWorker: Worker | null = null;
let storageRedis: Redis | null = null;

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

/**
 * Initialize the license heartbeat queue and worker.
 * Call once on engine startup after Redis is available.
 */
export function initLicenseHeartbeat(redisUrl: string): void {
  const connection = parseRedisConnection(redisUrl);

  // Separate Redis client for storing results (not tied to BullMQ lifecycle)
  storageRedis = new Redis({
    ...connection,
    maxRetriesPerRequest: undefined, // normal client, not BullMQ
    enableReadyCheck: false,
  });
  storageRedis.on("error", (err: unknown) => {
    console.error("[license-heartbeat] Redis storage error:", err);
  });

  heartbeatQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 50 },
    },
  });

  heartbeatWorker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      // Check Redis first (set by web app's /api/license/activate), fall back to env var
      let licenseKey = process.env.LICENSE_KEY;
      if (!licenseKey && storageRedis) {
        const redisKey = await storageRedis.get("license:key");
        if (redisKey) licenseKey = redisKey;
      }
      if (!licenseKey) {
        console.log("[license-heartbeat] No license key, skipping");
        const result = { skipped: true, checkedAt: new Date().toISOString() };
        await storageRedis!.set(REDIS_KEY, JSON.stringify(result));
        return result;
      }

      const licenseApiUrl =
        process.env.LICENSE_API_URL || "https://lead-routing-license.artyagi2011.workers.dev";

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(`${licenseApiUrl}/v1/licenses/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: licenseKey,
            fingerprint: hostname(),
            version: process.env.npm_package_version || "unknown",
            activeUsers: 0, // TODO: query from DB
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        const data = (await res.json()) as {
          tier?: string;
          valid?: boolean;
          validUntil?: string;
          graceActive?: boolean;
          daysRemaining?: number;
          [key: string]: unknown;
        };

        console.log("[license-heartbeat] Response:", JSON.stringify(data));

        // Update tier if changed
        if (data.tier && data.tier !== process.env.LICENSE_TIER) {
          console.log(
            `[license-heartbeat] Tier changed: ${process.env.LICENSE_TIER} -> ${data.tier}`
          );
          process.env.LICENSE_TIER = data.tier;
        }

        // Store result in Redis for web app dashboard
        const stored = { ...data, checkedAt: new Date().toISOString() };
        await storageRedis!.set(REDIS_KEY, JSON.stringify(stored));

        return data;
      } catch (err: any) {
        console.error("[license-heartbeat] Failed:", err.message);

        // Store failure in Redis
        const stored = { error: err.message, checkedAt: new Date().toISOString() };
        await storageRedis!.set(REDIS_KEY, JSON.stringify(stored));

        return stored;
      }
    },
    { connection }
  );

  heartbeatWorker.on("completed", (job: Job) => {
    console.log(`[license-heartbeat] Job ${job.name} (${job.id}) completed`);
  });

  heartbeatWorker.on("failed", (job: Job | undefined, err: Error) => {
    console.error(
      `[license-heartbeat] Job ${job?.name} (${job?.id}) failed:`,
      err.message
    );
  });

  heartbeatWorker.on("error", (err: Error) => {
    console.error("[license-heartbeat] Worker error:", err);
  });
}

/**
 * Schedule the weekly license heartbeat.
 * Removes any existing repeatable jobs, then adds:
 * - Weekly repeatable (Sundays 00:00 UTC)
 * - Immediate startup check
 */
export async function scheduleLicenseHeartbeat(): Promise<void> {
  if (!heartbeatQueue) {
    console.warn("[license-heartbeat] Queue not initialized — skipping schedule");
    return;
  }

  // Remove existing repeatable jobs first (to handle schedule changes)
  const existing = await heartbeatQueue.getRepeatableJobs();
  for (const job of existing) {
    await heartbeatQueue.removeRepeatableByKey(job.key);
  }

  // Schedule weekly heartbeat (every Sunday at midnight UTC)
  await heartbeatQueue.add(
    "weekly-heartbeat",
    {},
    { repeat: { pattern: "0 0 * * 0" } }
  );
  console.log("[license-heartbeat] Scheduled weekly heartbeat (Sundays 00:00 UTC)");

  // Also run immediately on startup
  await heartbeatQueue.add("startup-heartbeat", {});
  console.log("[license-heartbeat] Queued startup heartbeat");
}
