import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";
import { formatLogsSummary } from "../utils/format.js";

export const getFailedLogsTool = {
  name: "get_failed_logs",
  description: "Get failed routing logs — records that errored during routing.",
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
    },
  },
};

export async function handleGetFailedLogs(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const data = await web.getFailedLogs(args?.page, args?.limit);
  const logs = data.logs || data;
  logger.log({ tool: "get_failed_logs", action: "read", input: args, durationMs: Date.now() - start });

  let text = formatLogsSummary(logs);
  if (data.total !== undefined) {
    text += `\n\nTotal: ${data.total}`;
    if (data.page !== undefined) text += ` | Page: ${data.page}`;
    if (data.totalPages !== undefined) text += ` of ${data.totalPages}`;
  }

  return successResponse(text);
}
