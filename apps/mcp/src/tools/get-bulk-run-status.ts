import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getBulkRunStatusTool = {
  name: "get_bulk_run_status",
  description: "Check the status of a bulk search/route run — records found, processed, routed, failed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      runId: {
        type: "string",
        description: "The bulk run ID to check",
      },
    },
    required: ["runId"],
  },
};

export async function handleGetBulkRunStatus(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { runId } = args;
  const result = await web.getBulkRunStatus(runId);
  logger.log({ tool: "get_bulk_run_status", action: "read", input: { runId }, result, durationMs: Date.now() - start });

  const lines = [`Bulk Run ${runId}:`];
  if (result.status) lines.push(`  Status: ${result.status}`);
  if (result.totalRecords !== undefined) lines.push(`  Total Records: ${result.totalRecords}`);
  if (result.processed !== undefined) lines.push(`  Processed: ${result.processed}`);
  if (result.routed !== undefined) lines.push(`  Routed: ${result.routed}`);
  if (result.failed !== undefined) lines.push(`  Failed: ${result.failed}`);
  if (result.startedAt) lines.push(`  Started: ${result.startedAt}`);
  if (result.completedAt) lines.push(`  Completed: ${result.completedAt}`);

  return successResponse(lines.join("\n"));
}
