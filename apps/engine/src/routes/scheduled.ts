import type { FastifyInstance } from "fastify";
import { runScheduledRoute, type RunResult } from "../search-runner.js";
import { buildCountSOQL } from "../soql-builder.js";
import { getOrgConnection } from "../sfdc.js";
import { validateInternalToken } from "../middleware/validate-internal.js";

interface RunScheduledBody {
  ruleId: string;
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

    const { ruleId } = request.body;
    if (!ruleId) {
      return reply.status(400).send({ error: "Missing ruleId" });
    }

    try {
      const result: RunResult = await runScheduledRoute(ruleId, orgId);
      return reply.send(result);
    } catch (err: any) {
      request.log.error(err, "Failed to run scheduled route");
      return reply.status(500).send({ error: "Internal error", detail: err.message });
    }
  });
}
