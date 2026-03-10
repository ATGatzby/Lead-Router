import type { FastifyInstance } from "fastify";
import { enqueueConversionCheck, enqueueReconciliation } from "../analytics-queue.js";
import { validateInternalToken } from "../middleware/validate-internal.js";

export async function analyticsPlugin(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", validateInternalToken);

  app.post("/analytics/conversion-check", async (_request, reply) => {
    await enqueueConversionCheck();
    return reply.send({ status: "queued" });
  });

  app.post("/analytics/reconcile", async (request, reply) => {
    const body = request.body as { date?: string } | null;
    const date = body?.date ? new Date(body.date) : undefined;
    await enqueueReconciliation(date);
    return reply.send({ status: "queued" });
  });
}
