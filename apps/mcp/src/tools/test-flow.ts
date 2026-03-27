import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const testFlowTool = {
  name: "test_flow",
  description: "Test a routing flow against sample field values. Returns the path the record would take through the decision tree.",
  inputSchema: {
    type: "object" as const,
    properties: {
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT"],
        description: "Salesforce object type",
      },
      fields: {
        type: "object",
        description: "Record field values as key-value pairs to test against the flow",
      },
    },
    required: ["objectType", "fields"],
  },
};

export async function handleTestFlow(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { objectType, fields } = args;
  const data = await web.testFlow(objectType, fields);
  logger.log({ tool: "test_flow", action: "read", input: { objectType, fieldCount: Object.keys(fields).length }, durationMs: Date.now() - start });

  const lines = [
    "Flow Test Result",
    `  Object Type: ${objectType}`,
    `  Outcome: ${data.outcome ?? data.status ?? "—"}`,
  ];

  if (data.assignedTo) lines.push(`  Assigned To: ${data.assignedTo}`);
  if (data.matchedRule) lines.push(`  Matched Rule: ${data.matchedRule}`);

  if (Array.isArray(data.path) && data.path.length) {
    lines.push("\n  Path:");
    for (const step of data.path) {
      lines.push(`    → ${step.label ?? step.name ?? step.nodeId}${step.result !== undefined ? ` (${step.result})` : ""}`);
    }
  }

  if (data.message) lines.push(`\n  Message: ${data.message}`);

  return successResponse(lines.join("\n"));
}
