import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";
import { formatRulesSummary } from "../utils/format.js";

export const listRulesTool = {
  name: "list_rules",
  description: "List all routing rules, optionally filtered by Salesforce object type (LEAD, CONTACT, or ACCOUNT)",
  inputSchema: {
    type: "object" as const,
    properties: {
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT"],
        description: "Filter rules by Salesforce object type",
      },
    },
  },
};

export async function handleListRules(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const data = await web.listRules(args?.objectType);
  const rules = data.rules || data;
  logger.log({ tool: "list_rules", action: "read", input: args, durationMs: Date.now() - start });
  return successResponse(formatRulesSummary(rules));
}
