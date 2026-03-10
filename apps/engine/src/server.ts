import Fastify from "fastify";
import { loadAllRules, startCacheInvalidationListener } from "./cache.js";
import { routePlugin } from "./routes/route.js";
import { analyticsPlugin } from "./routes/analytics.js";
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

    // Pre-warm rule cache from DB
    await loadAllRules();

    // Subscribe to cache invalidation events from the web app
    const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
    startCacheInvalidationListener(redisUrl);

    const port = Number(process.env.ENGINE_PORT ?? 3001);
    await app.listen({ port, host: "0.0.0.0" });
    console.log(`Engine listening on port ${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
