import { hostname } from "os";
import Fastify from "fastify";
import { loadAllRules, startCacheInvalidationListener } from "./cache.js";
import { routePlugin } from "./routes/route.js";
import { analyticsPlugin } from "./routes/analytics.js";
import { scheduledPlugin } from "./routes/scheduled.js";
import { initScheduler, syncScheduledJobs } from "./scheduler.js";
import { initLicenseHeartbeat, scheduleLicenseHeartbeat } from "./license-heartbeat.js";
// Import workers to start them (side-effect: registers BullMQ event handlers)
import "./queue.js";
import "./batch-queue.js";
import "./analytics-queue.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
  },
});

// ── Raw body plugin (needed for HMAC validation) ─────────────────────────
// Fastify 5 exposes rawBody via addContentTypeParser + preParsing
app.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  (req, body, done) => {
    try {
      (req as unknown as { rawBody: string }).rawBody = body as string;
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// ── Routes ────────────────────────────────────────────────────────────────
app.get("/health", async () => ({
  status: "ok",
  ts: new Date().toISOString(),
}));

// ── Startup ───────────────────────────────────────────────────────────────
const start = async () => {
  try {
    await app.register(routePlugin);
    await app.register(analyticsPlugin);
    await app.register(scheduledPlugin);

    // Pre-warm rule cache from DB
    await loadAllRules();

    // Subscribe to cache invalidation events from the web app
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    startCacheInvalidationListener(redisUrl);

    // Initialize scheduler for scheduled routes (cron jobs)
    initScheduler(redisUrl);
    await syncScheduledJobs();

    // License heartbeat (weekly phone-home to keep license fresh)
    initLicenseHeartbeat(redisUrl);
    await scheduleLicenseHeartbeat();

    // ── License validation on startup ──────────────────────────────────
    const licenseKey = process.env.LICENSE_KEY;
    if (licenseKey) {
      const licenseApiUrl =
        process.env.LICENSE_API_URL || "https://lead-routing-license.artyagi2011.workers.dev";
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(
          `${licenseApiUrl}/v1/licenses/validate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: licenseKey,
              fingerprint: hostname(),
            }),
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);
        const data = (await res.json()) as {
          valid: boolean;
          tier?: string;
        };
        if (data.valid) {
          console.log(`[license] License valid (${data.tier} tier)`);
          process.env.LICENSE_TIER = data.tier || "pro";
        } else {
          console.warn("[license] License invalid, running in FREE tier");
          process.env.LICENSE_TIER = "free";
        }
      } catch (err) {
        console.warn(
          "[license] License server unreachable, running with current tier setting"
        );
      }
    } else {
      console.log("[license] No license key — running in FREE tier");
      process.env.LICENSE_TIER = "free";
    }

    const port = Number(process.env.ENGINE_PORT ?? 3001);
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`Engine listening on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
