import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const listFieldsTool = {
  name: "list_fields",
  description: "List Salesforce field schemas synced for routing. Shows field names, types, and picklist values available for rule conditions.",
  inputSchema: {
    type: "object" as const,
    properties: {
      objectType: {
        type: "string",
        description: "Filter fields by Salesforce object type (e.g. LEAD, CONTACT, ACCOUNT)",
      },
    },
  },
};

export async function handleListFields(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const data = await web.listFields(args?.objectType);
  const fields = data.fields || data;
  logger.log({ tool: "list_fields", action: "read", input: args, durationMs: Date.now() - start });

  if (!Array.isArray(fields) || fields.length === 0) {
    return successResponse("No fields found. Run sync_fields to sync field schemas from Salesforce.");
  }

  const lines = [`${fields.length} field(s) synced:`];
  for (const f of fields) {
    const picklist = f.picklistValues?.length ? ` (${f.picklistValues.length} values)` : "";
    lines.push(`  ${f.name} — ${f.type || f.fieldType || "unknown"}${picklist}`);
  }

  return successResponse(lines.join("\n"));
}
