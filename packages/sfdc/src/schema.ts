import type { Connection } from "jsforce";
import { prisma } from "@lead-routing/db";

type SfdcObjectType = "Lead" | "Contact" | "Account";

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
 * Sync the field schema for a given SFDC object type.
 * Fetches field metadata via describeSObject and upserts into field_schemas table.
 */
export async function syncFieldSchema(
  conn: Connection,
  orgId: string,
  objectType: SfdcObjectType
): Promise<number> {
  const describe = await conn.describe(objectType);

  const fields = describe.fields
    .filter((f) => f.createable || f.updateable)
    .map((f) => ({
      orgId,
      objectType: objectType.toUpperCase() as "LEAD" | "CONTACT" | "ACCOUNT",
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
      objectType: objectType.toUpperCase() as "LEAD" | "CONTACT" | "ACCOUNT",
    },
  });

  await prisma.fieldSchema.createMany({ data: fields });

  return fields.length;
}
