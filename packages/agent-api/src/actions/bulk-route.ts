import { ok, fail, type AgentContext, type AgentResponse } from "../types";

interface BulkRouteInput {
  objectType: string;
  eventType?: string;
  records: Array<{ recordId: string; fields: Record<string, unknown> }>;
  ruleId?: string;
}

interface BulkRouteOutput {
  accepted: number;
  duplicates: number;
  batchId?: string;
}

export async function bulkRoute(
  input: BulkRouteInput,
  ctx: AgentContext,
): Promise<AgentResponse<BulkRouteOutput | null>> {
  const start = Date.now();
  const tool = "bulk_route";
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

    const result = await ctx.engineGateway.routeBatch({
      objectType: input.objectType,
      eventType: input.eventType ?? "INSERT",
      records: input.records,
      ruleId: input.ruleId,
    });

    actions.push(
      `Bulk routed ${result.accepted} ${input.objectType} record(s)`,
    );

    if (result.duplicates > 0) {
      actions.push(`${result.duplicates} duplicate(s) skipped`);
    }

    return ok(
      {
        accepted: result.accepted,
        duplicates: result.duplicates,
        batchId: result.batchId,
      },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        next_actions: [
          { action: "retry_failed", reason: "Retry any failed records" },
          { action: "get_performance", reason: "Check routing metrics after bulk operation" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "BULK_ROUTE_FAILED",
      error instanceof Error ? error.message : String(error),
      "Verify the engine is running and all record data is valid. Consider smaller batch sizes if timeout occurred.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
