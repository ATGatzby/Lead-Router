import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { LogService } from "../services/log";

interface ExportReportInput {
  fromDate: string;
  toDate: string;
  format?: "csv" | "json";
  objectType?: string;
  status?: string;
  ruleId?: string;
  limit?: number;
}

interface ExportReportOutput {
  format: string;
  recordCount: number;
  data: unknown;
}

export async function exportReport(
  input: ExportReportInput,
  ctx: AgentContext,
): Promise<AgentResponse<ExportReportOutput | null>> {
  const start = Date.now();
  const tool = "export_report";
  const actions: string[] = [];
  const warnings: string[] = [];
  const format = input.format ?? "csv";

  try {
    const logs = await LogService.export(
      {
        fromDate: new Date(input.fromDate),
        toDate: new Date(input.toDate),
        objectType: input.objectType,
        status: input.status,
        ruleId: input.ruleId,
        limit: input.limit ?? 5000,
      },
      ctx,
    );

    const recordCount = logs.length;
    actions.push(`Exported ${recordCount} assignment record(s) as ${format.toUpperCase()}`);

    if (recordCount === 0) {
      warnings.push("No records found for the specified filters");
    }

    let data: unknown;
    if (format === "csv") {
      if (logs.length > 0) {
        const headers = Object.keys(logs[0]!);
        const rows = logs.map((log) => headers.map((h) => String(log[h] ?? "")).join(","));
        data = [headers.join(","), ...rows].join("\n");
      } else {
        data = "";
      }
    } else {
      data = logs;
    }

    return ok(
      { format, recordCount, data },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "get_performance", reason: "View analytics summary" },
          { action: "retry_failed", reason: "Retry any failed assignments" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "EXPORT_REPORT_FAILED",
      error instanceof Error ? error.message : String(error),
      "Check database connectivity. Try a shorter period if the query times out.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
