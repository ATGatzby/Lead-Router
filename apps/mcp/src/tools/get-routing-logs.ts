import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";
import { formatLogsSummary } from "../utils/format.js";

export const getRoutingLogsTool = {
  name: "get_routing_logs",
  description: "Get routing execution logs with optional filters for pagination, object type, status, or rule",
  inputSchema: {
    type: "object" as const,
    properties: {
      page: {
        type: "number",
        description: "Page number (1-based)",
      },
      limit: {
        type: "number",
        description: "Number of logs per page (default 20)",
      },
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT"],
        description: "Filter by Salesforce object type",
      },
      status: {
        type: "string",
        description: "Filter by routing status (e.g. SUCCESS, FAILED, NO_MATCH)",
      },
      ruleId: {
        type: "string",
        description: "Filter by specific rule ID",
      },
    },
  },
};

export async function handleGetRoutingLogs(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const filters: Record<string, string | number> = {};
  if (args?.page) filters.page = args.page;
  if (args?.limit) filters.limit = args.limit;
  if (args?.objectType) filters.objectType = args.objectType;
  if (args?.status) filters.status = args.status;
  if (args?.ruleId) filters.ruleId = args.ruleId;

  const data = await web.getRoutingLogs(Object.keys(filters).length ? filters : undefined);
  const logs = data.logs || data;
  logger.log({ tool: "get_routing_logs", action: "read", input: filters, durationMs: Date.now() - start });

  let text = formatLogsSummary(logs);
  if (data.total !== undefined) {
    text += `\n\nTotal: ${data.total}`;
    if (data.page !== undefined) text += ` | Page: ${data.page}`;
    if (data.pageCount !== undefined) text += ` of ${data.pageCount}`;
  }

  return successResponse(text);
}
