import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { LogService } from "../services/log";

interface RetryFailedInput {
  fromDate?: string;
  toDate?: string;
  ruleId?: string;
  limit?: number;
}

interface RetryFailedOutput {
  retried: number;
  skipped: number;
}

export async function retryFailed(
  input: RetryFailedInput,
  ctx: AgentContext,
): Promise<AgentResponse<RetryFailedOutput | null>> {
  const start = Date.now();
  const tool = "retry_failed";
  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    const result = await LogService.retryAll(
      {
        fromDate: input.fromDate ? new Date(input.fromDate) : undefined,
        toDate: input.toDate ? new Date(input.toDate) : undefined,
        ruleId: input.ruleId,
        limit: input.limit ?? 100,
      },
      ctx,
    );

    actions.push(`Marked ${result.retried} failed assignment(s) for retry`);

    if (result.retried === 0) {
      warnings.push("No failed records found matching the specified filters");
    }

    return ok(
      { retried: result.retried, skipped: result.skipped },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "get_routing_status", reason: "Check system health after retry" },
          { action: "export_report", reason: "Export failure details for analysis" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "RETRY_FAILED_ERROR",
      error instanceof Error ? error.message : String(error),
      "Check engine connectivity and CRM write permissions.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
