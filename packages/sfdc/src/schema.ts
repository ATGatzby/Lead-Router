import type { Connection } from "jsforce";
import { prisma } from "@lead-routing/db";

type SfdcObjectType = "Lead" | "Contact" | "Account" | "User";

/** Map jsforce field type strings to our internal FieldType enum values */
function mapSfdcType(type: string): string {
  switch (type) {
    case "string":
    case "textarea":
    case "email":
    case "phone":
    case "url":
    case "id":
      return "TEXT";
    case "int":
    case "double":
    case "currency":
    case "percent":
      return "NUMBER";
    case "date":
      return "DATE";
    case "datetime":
      return "DATETIME";
    case "boolean":
      return "BOOLEAN";
    case "picklist":
      return "PICKLIST";
    case "multipicklist":
      return "MULTI_PICKLIST";
    case "reference":
      return "LOOKUP";
    default:
      return "TEXT";
  }
}

/**
 * Fetch the set of field API names present on the default page layout
 * for the given object type via the Describe Layouts REST API.
 */
async function getLayoutFieldNames(
  conn: Connection,
  objectType: SfdcObjectType
): Promise<Set<string>> {
  const fieldNames = new Set<string>();

  try {
    const res = await conn.request(
      `/services/data/v62.0/sobjects/${objectType}/describe/layouts`
    ) as {
      layouts?: Array<{
        detailLayoutSections?: Array<{
          layoutRows?: Array<{
            layoutItems?: Array<{
              layoutComponents?: Array<{
                value?: string;
                type?: string;
              }>;
            }>;
          }>;
        }>;
      }>;
    };

    // Extract field names from all layout sections of the first (default) layout
    const layout = res.layouts?.[0];
    if (layout?.detailLayoutSections) {
      for (const section of layout.detailLayoutSections) {
        for (const row of section.layoutRows ?? []) {
          for (const item of row.layoutItems ?? []) {
            for (const comp of item.layoutComponents ?? []) {
              if (comp.type === "Field" && comp.value) {
                fieldNames.add(comp.value);
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn(`describeLayouts failed for ${objectType}, falling back to all fields:`, err);
  }

  return fieldNames;
}

/**
 * Sync the field schema for a given SFDC object type.
 * Fetches field metadata via describeSObject, then filters to only fields
 * present on the user's default page layout (via Describe Layouts API).
 * Formula fields, roll-ups, and other read-only fields are included
 * as long as they appear on the layout.
 */
export async function syncFieldSchema(
  conn: Connection,
  orgId: string,
  objectType: SfdcObjectType
): Promise<number> {
  // Fetch layout fields and full describe in parallel
  const [layoutFieldNames, describe] = await Promise.all([
    getLayoutFieldNames(conn, objectType),
    conn.describe(objectType),
  ]);

  const hasLayout = layoutFieldNames.size > 0;

  const fields = describe.fields
    .filter((f) => {
      // If we got layout fields, only include fields on the layout
      if (hasLayout) return layoutFieldNames.has(f.name);
      // Fallback: include all accessible fields if layout fetch failed
      return true;
    })
    .map((f) => ({
      orgId,
      objectType: objectType.toUpperCase() as "LEAD" | "CONTACT" | "ACCOUNT" | "USER",
      fieldApiName: f.name,
      fieldLabel: f.label,
      fieldType: mapSfdcType(f.type as string),
      picklistValues:
        f.picklistValues && f.picklistValues.length > 0
          ? f.picklistValues.map((v: { value: string }) => v.value)
          : undefined,
    }));

  // Replace all field schemas for this org + object type
  await prisma.fieldSchema.deleteMany({
    where: {
      orgId,
      objectType: objectType.toUpperCase() as "LEAD" | "CONTACT" | "ACCOUNT" | "USER",
    },
  });

  await prisma.fieldSchema.createMany({ data: fields });

  return fields.length;
}
