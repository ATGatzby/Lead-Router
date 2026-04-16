import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const listFieldsTool = {
  name: "list_fields",
  description: "List CRM field schemas synced for routing. Shows field names, types, and picklist values available for rule conditions and field updates. Works for both Salesforce and HubSpot. If no fields returned, call sync_fields first.",
  inputSchema: {
    type: "object" as const,
    properties: {
      objectType: {
        type: "string",
        description: "Filter by object type. Salesforce: LEAD, CONTACT, ACCOUNT. HubSpot: CONTACT, COMPANY, DEAL. Auto-maps between CRMs (e.g. ACCOUNT → COMPANY for HubSpot).",
      },
    },
  },
};

// Map Salesforce object types to HubSpot equivalents and vice versa
const SFDC_TO_HUBSPOT: Record<string, string> = { LEAD: "CONTACT", ACCOUNT: "COMPANY" };
const HUBSPOT_TO_SFDC: Record<string, string> = { COMPANY: "ACCOUNT", DEAL: "LEAD" };

async function detectCrmType(web: WebClient): Promise<string> {
  try {
    const license = await web.getLicenseInfo() as any;
    return license?.crmType ?? "SALESFORCE";
  } catch {
    return "SALESFORCE";
  }
}

function mapObjectType(objectType: string, crmType: string): string {
  if (crmType === "HUBSPOT" && SFDC_TO_HUBSPOT[objectType]) {
    return SFDC_TO_HUBSPOT[objectType];
  }
  if (crmType === "SALESFORCE" && HUBSPOT_TO_SFDC[objectType]) {
    return HUBSPOT_TO_SFDC[objectType];
  }
  return objectType;
}

export async function handleListFields(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  let objectType = args?.objectType?.toUpperCase?.() ?? undefined;

  // Auto-map objectType based on CRM
  let crmType = "SALESFORCE";
  if (objectType) {
    crmType = await detectCrmType(web);
    const mapped = mapObjectType(objectType, crmType);
    if (mapped !== objectType) {
      logger.log({ tool: "list_fields", action: "map_object_type", from: objectType, to: mapped, crmType });
      objectType = mapped;
    }
  }

  const data = await web.listFields(objectType);
  const fields = data.fields || data;
  logger.log({ tool: "list_fields", action: "read", input: { ...args, resolvedObjectType: objectType, crmType }, durationMs: Date.now() - start });

  if (!Array.isArray(fields) || fields.length === 0) {
    const hint = crmType === "HUBSPOT"
      ? `No fields found for ${objectType || "any object type"}. Run sync_fields (with confirm: true) to sync HubSpot field schemas.`
      : `No fields found for ${objectType || "any object type"}. Run sync_fields (with confirm: true) to sync field schemas from your CRM.`;
    return successResponse(hint);
  }

  const lines = [`${fields.length} field(s) for ${objectType ?? "all objects"} (${crmType}):`];
  for (const f of fields) {
    const name = f.fieldApiName || f.name;
    const label = f.fieldLabel || f.label || "";
    const type = f.fieldType || f.type || "unknown";
    const picklist = f.picklistValues?.length ? ` (${f.picklistValues.length} values)` : "";
    lines.push(`  ${name} — ${label} [${type}]${picklist}`);
  }

  return successResponse(lines.join("\n"));
}
