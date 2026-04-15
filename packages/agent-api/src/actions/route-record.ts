import { ok, fail, type AgentContext, type AgentResponse } from "../types";

interface RouteRecordInput {
  objectType: string;
  eventType?: string;
  recordId: string;
  fields: Record<string, unknown>;
  ruleId?: string;
}

interface RouteRecordOutput {
  status: string;
  latencyMs?: number;
  ruleId?: string;
  assignedTo?: string;
}

export async function routeRecord(
  input: RouteRecordInput,
  ctx: AgentContext,
): Promise<AgentResponse<RouteRecordOutput | null>> {
  const start = Date.now();
  const tool = "route_record";
  const actions: string[] = [];

  try {
    if (!ctx.engineGateway) {
      return fail(
        "ENGINE_GATEWAY_MISSING",
        "Engine gateway is not configured on this context",
        "Ensure the engine is running and the agent context includes an engineGateway instance.",
        tool,
        ctx.crmType,
        Date.now() - start,
      );
    }

    const result = await ctx.engineGateway.routeSingle({
      objectType: input.objectType,
      eventType: input.eventType ?? "INSERT",
      recordId: input.recordId,
      fields: input.fields,
      ruleId: input.ruleId,
    });
    actions.push(
      `Routed ${input.objectType} ${input.recordId} -- status: ${result.status}`,
    );

    return ok(
      {
        status: result.status,
        latencyMs: result.latencyMs,
        ruleId: result.ruleId,
        assignedTo: result.assignedTo,
      },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        next_actions: [
          { action: "get_routing_status", reason: "Check overall routing health" },
          { action: "get_performance", reason: "View routing analytics" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "ROUTE_RECORD_FAILED",
      error instanceof Error ? error.message : String(error),
      "Verify the engine is running, the record exists, and at least one active rule matches this object type.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
