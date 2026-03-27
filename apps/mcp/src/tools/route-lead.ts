import type { EngineClient } from "../clients/engine-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const routeLeadTool = {
  name: "route_lead",
  description: "Route a single Salesforce record through the routing engine. Sends the record to the engine for evaluation against active rules and assignment.",
  inputSchema: {
    type: "object" as const,
    properties: {
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT"],
        description: "Salesforce object type",
      },
      eventType: {
        type: "string",
        enum: ["INSERT", "UPDATE", "BOTH"],
        description: "Event type — use INSERT for new records, UPDATE for modified records",
      },
      recordId: {
        type: "string",
        description: "Salesforce record ID (e.g. 00Q...)",
      },
      fields: {
        type: "object",
        description: "Record field values as key-value pairs",
      },
      ruleId: {
        type: "string",
        description: "Optional: target a specific rule by ID instead of evaluating all rules",
      },
    },
    required: ["objectType", "eventType", "recordId", "fields"],
  },
};

export async function handleRouteLead(engine: EngineClient, logger: Logger, args: any) {
  const start = Date.now();
  const { objectType, eventType, recordId, fields, ruleId } = args;

  const result = await engine.routeSingle({ objectType, eventType, recordId, fields, ruleId });
  const durationMs = Date.now() - start;
  logger.log({ tool: "route_lead", action: "execute", input: { objectType, eventType, recordId, ruleId }, result, durationMs });

  const lines = [
    "Routing complete.",
    `Status: ${result.status || "OK"}`,
    `Latency: ${durationMs}ms`,
  ];
  if (result.ruleId) lines.push(`Matched Rule: ${result.ruleId}`);
  if (result.assignedTo) lines.push(`Assigned To: ${result.assignedTo}`);
  if (result.message) lines.push(`Message: ${result.message}`);

  return successResponse(lines.join("\n"));
}
