import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getAuditLogsTool = {
  name: "get_audit_logs",
  description: "Get audit logs — history of all admin actions (rule changes, team modifications, license updates).",
  inputSchema: {
    type: "object" as const,
    properties: {
      page: {
        type: "number",
        description: "Page number (1-based)",
      },
      limit: {
        type: "number",
        description: "Number of entries per page (default 20)",
      },
      action: {
        type: "string",
        description: "Filter by action type (e.g. CREATE, UPDATE, DELETE)",
      },
      entityType: {
        type: "string",
        description: "Filter by entity type (e.g. RULE, TEAM, USER)",
      },
    },
  },
};

export async function handleGetAuditLogs(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const filters: Record<string, string | number> = {};
  if (args?.page) filters.page = args.page;
  if (args?.limit) filters.limit = args.limit;
  if (args?.action) filters.action = args.action;
  if (args?.entityType) filters.entityType = args.entityType;

  const data = await web.getAuditLogs(Object.keys(filters).length ? filters : undefined);
  const logs = data.logs || data;
  logger.log({ tool: "get_audit_logs", action: "read", input: filters, durationMs: Date.now() - start });

  if (!Array.isArray(logs) || !logs.length) return successResponse("No audit logs found.");

  let text = logs
    .map((l: any) =>
      `• ${l.action} ${l.entityType ?? ""} — ${l.userName ?? l.userId ?? "system"} (${new Date(l.createdAt).toLocaleString()})${l.details ? `\n  ${l.details}` : ""}`
    )
    .join("\n");

  if (data.total !== undefined) {
    text += `\n\nTotal: ${data.total}`;
    if (data.page !== undefined) text += ` | Page: ${data.page}`;
    if (data.totalPages !== undefined) text += ` of ${data.totalPages}`;
  }

  return successResponse(text);
}
