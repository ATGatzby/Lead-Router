import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getRecordJourneyTool = {
  name: "get_record_journey",
  description: "Get the full routing journey for a Salesforce record — every routing event, rule evaluation, and assignment decision",
  inputSchema: {
    type: "object" as const,
    properties: {
      recordId: {
        type: "string",
        description: "Salesforce record ID to trace (e.g. 00Q...)",
      },
    },
    required: ["recordId"],
  },
};

export async function handleGetRecordJourney(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const data = await web.getRecordJourney(args.recordId);
  const events = data.entries || data.events || data.journey || data;
  logger.log({ tool: "get_record_journey", action: "read", input: args, durationMs: Date.now() - start });

  if (!Array.isArray(events) || events.length === 0) {
    return successResponse(`No routing events found for record ${args.recordId}.`);
  }

  const lines = [`Routing journey for ${args.recordId} (${events.length} event(s)):\n`];

  for (const event of events) {
    const ts = event.createdAt ? new Date(event.createdAt).toLocaleString() : "?";
    const status = event.status || "?";
    const rule = event.rule?.name || event.ruleId || "—";
    const assignee = event.assignedTo?.name || event.assignedToId || "—";

    lines.push(`[${ts}] ${status}`);
    lines.push(`  Rule: ${rule}`);
    lines.push(`  Assigned To: ${assignee}`);

    if (event.decisionTrace) {
      const trace = typeof event.decisionTrace === "string"
        ? event.decisionTrace
        : JSON.stringify(event.decisionTrace, null, 2);
      lines.push(`  Decision Trace: ${trace}`);
    }

    lines.push("");
  }

  return successResponse(lines.join("\n"));
}
