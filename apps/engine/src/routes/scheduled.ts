import type { FastifyInstance } from "fastify";
import { prisma } from "@lead-routing/db";
import { runScheduledRoute, type RunResult } from "../search-runner.js";
import { buildCountSOQL } from "../soql-builder.js";
import { getOrgConnection } from "../sfdc.js";
import { getRedis } from "../redis.js";
import { validateInternalToken } from "../middleware/validate-internal.js";

interface RunScheduledBody {
  ruleId: string;
  runId?: string; // Pre-created bulk run ID from web API (for UI polling)
}

interface PreviewCountBody {
  objectType: string;
  searchCriteria: Array<{ id: string; conditions: Array<{ fieldApiName: string; fieldType?: string; operator: string; value: string | null }> }> | null;
}

export async function scheduledPlugin(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", validateInternalToken);

  // Preview count — returns number of records matching criteria without routing
  app.post<{ Body: PreviewCountBody }>("/preview-count", async (request, reply) => {
    const orgId = request.headers["x-org-id"] as string;
    if (!orgId) {
      return reply.status(400).send({ error: "Missing X-Org-Id header" });
    }

    const { objectType, searchCriteria } = request.body;
    try {
      const conn = await getOrgConnection(orgId);
      const soql = buildCountSOQL(objectType, searchCriteria);
      const result = await conn.query(soql);
      const count = (result as any).totalSize ?? 0;
      return reply.send({ count });
    } catch (err: any) {
      request.log.error(err, "Failed to get preview count");
      return reply.status(500).send({ error: "Preview failed", detail: err.message });
    }
  });

  app.post<{ Body: RunScheduledBody }>("/run-scheduled", async (request, reply) => {
    const orgId = request.headers["x-org-id"] as string;
    if (!orgId) {
      return reply.status(400).send({ error: "Missing X-Org-Id header" });
    }

    const { ruleId, runId } = request.body;
    if (!ruleId) {
      return reply.status(400).send({ error: "Missing ruleId" });
    }

    try {
      const result: RunResult = await runScheduledRoute(ruleId, orgId, runId);
      return reply.send(result);
    } catch (err: any) {
      request.log.error(err, "Failed to run scheduled route");
      return reply.status(500).send({ error: "Internal error", detail: err.message });
    }
  });

  // ── Bulk run progress ────────────────────────────────────────────────
  app.get<{ Params: { runId: string } }>("/bulk-run/:runId/status", async (request, reply) => {
    const { runId } = request.params;

    // Try Redis first (live progress while job is running)
    const redis = getRedis();
    const liveData = await redis.hgetall(`bulk-run:${runId}`);

    if (liveData && liveData.status === "RUNNING") {
      return reply.send({
        status: "RUNNING",
        phase: liveData.phase || "routing",
        writePending: parseInt(liveData.writePending || "0"),
        recordsProcessed: parseInt(liveData.processed || "0"),
        recordsRouted: parseInt(liveData.routed || "0"),
        recordsFailed: parseInt(liveData.failed || "0"),
      });
    }

    // Fallback to DB (completed/cancelled runs)
    const run = await prisma.bulkSearchRun.findUnique({ where: { id: runId } });
    if (!run) return reply.status(404).send({ error: "Run not found" });

    return reply.send({
      status: run.status,
      phase: "complete",
      writePending: 0,
      recordsFound: run.recordsFound,
      recordsProcessed: run.recordsProcessed,
      recordsRouted: run.recordsRouted,
      recordsFailed: run.recordsFailed,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationMs: run.durationMs,
    });
  });

  // ── Bulk run cancellation ────────────────────────────────────────────
  app.post<{ Params: { runId: string } }>("/bulk-run/:runId/cancel", async (request, reply) => {
    const { runId } = request.params;

    // Set cancel flag in Redis (bulk-search workers check this between batches)
    const redis = getRedis();
    await redis.set(`bulk-run:${runId}:cancel`, "1", "EX", 3600);

    // Update DB status
    await prisma.bulkSearchRun.update({
      where: { id: runId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });

    return reply.send({ cancelled: true });
  });
}
