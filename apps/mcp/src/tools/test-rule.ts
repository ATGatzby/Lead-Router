import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const testRuleTool = {
  name: "test_rule",
  description: `Test a routing rule against sample field values. Returns whether the rule would match and which branch/assignee would be selected.

Use this AFTER creating or updating a rule to verify it works correctly. Pass field values that should match a specific branch.

IMPORTANT: Field names in the "fields" object must match the fieldApiName / fieldName used in the rule's conditions.
Values should be the appropriate type (string for TEXT/PICKLIST, number for NUMBER, ISO date string for DATE, boolean for BOOLEAN).

EXAMPLE — Testing a region+size rule:
{
  "ruleId": "rule-123",
  "fields": {
    "country": "US",
    "numberofemployees": 1500,
    "industry": "Technology",
    "annualrevenue": 5000000
  }
}

The response will show:
- Whether the rule matched (YES/NO)
- Which branch was matched (label + ID)
- Who the record would be assigned to
- If steps/splits are configured, which path was followed

TIP: Test multiple scenarios — try values that should match different branches, and values that should match NO branch (to verify the fallback/default behavior).`,
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
