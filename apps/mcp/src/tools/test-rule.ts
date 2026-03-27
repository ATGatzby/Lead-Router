import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const testRuleTool = {
  name: "test_rule",
  description: "Test a routing rule against sample field values. Returns whether the rule would match and which branch/assignee would be selected.",
  inputSchema: {
    type: "object" as const,
    properties: {
      ruleId: {
        type: "string",
        description: "The ID of the routing rule to test",
      },
      fields: {
        type: "object",
        description: "Sample field values to test against (e.g. { \"AnnualRevenue\": 500000, \"Industry\": \"Technology\" })",
      },
    },
    required: ["ruleId", "fields"],
  },
};

export async function handleTestRule(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { ruleId, fields } = args;

  const result = await web.testRule(ruleId, fields);
  const lines = [
    `Test result for rule ${ruleId}:`,
    `  Match: ${result.match ? "YES" : "NO"}`,
  ];
  if (result.branch) lines.push(`  Matched Branch: ${result.branch.label || result.branch.id}`);
  if (result.assignee) lines.push(`  Assignee: ${result.assignee.name || result.assignee.id}`);
  if (result.reason) lines.push(`  Reason: ${result.reason}`);

  logger.log({ tool: "test_rule", action: "read", input: args, result, durationMs: Date.now() - start });
  return successResponse(lines.join("\n"));
}
