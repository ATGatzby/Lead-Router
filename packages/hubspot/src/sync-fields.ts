import { HubSpotClient } from './client';
import { PropertiesApi } from './properties';
import type { CrmObjectType as HubSpotObjectType } from './types';

// Prisma is a peer dependency — imported at runtime from the web app's context
// eslint-disable-next-line @typescript-eslint/no-require-imports
let prisma: any;
try {
  prisma = require('@lead-routing/db').prisma;
} catch {
  // Will be provided by the calling context
}

/** Map HubSpot property type strings to our internal FieldType values */
function mapHubSpotType(type: string, fieldType: string): string {
  switch (type) {
    case 'string':
      return 'TEXT';
    case 'number':
      return 'NUMBER';
    case 'date':
      return 'DATE';
    case 'datetime':
      return 'DATETIME';
    case 'bool':
      return 'BOOLEAN';
    case 'enumeration':
      return fieldType === 'checkbox' ? 'MULTI_PICKLIST' : 'PICKLIST';
    default:
      return 'TEXT';
  }
}

/** Map HubSpot API object type names to our CrmObjectType enum values */
const OBJECT_TYPE_MAP: Record<HubSpotObjectType, string> = {
  contacts: 'CONTACT',
  companies: 'COMPANY',
  deals: 'DEAL',
};

/**
 * Sync HubSpot property metadata into the FieldSchema table.
 * Mirrors the Salesforce `syncFieldSchema` pattern in @lead-routing/sfdc.
 *
 * @param accessToken  HubSpot OAuth access token
 * @param orgId        Organization ID in our database
 * @param db           Prisma client instance (passed from caller to avoid import issues)
 * @returns            Total number of fields synced across all object types
 */
export async function syncHubSpotFields(
  accessToken: string,
  orgId: string,
  db?: any,
): Promise<number> {
  const p = db ?? prisma;
  if (!p) throw new Error('Prisma client not available');

  const client = new HubSpotClient({ accessToken });
  const propertiesApi = new PropertiesApi(client);

  const objectTypes: HubSpotObjectType[] = ['contacts', 'companies', 'deals'];
  let totalSynced = 0;

  for (const hsObjectType of objectTypes) {
    const crmObjectType = OBJECT_TYPE_MAP[hsObjectType];
    const properties = await propertiesApi.listProperties(hsObjectType);

    // Filter out hidden properties only — keep calculated (formula) fields
    // so users can use them in routing criteria
    const fields = properties
      .filter((prop) => !prop.hidden)
      .map((prop) => ({
        orgId,
        objectType: crmObjectType,
        fieldApiName: prop.name,
        fieldLabel: prop.label,
        fieldType: mapHubSpotType(prop.type, prop.fieldType),
        picklistValues:
          prop.options && prop.options.length > 0
            ? prop.options.filter((o) => !o.hidden).map((o) => o.value)
            : undefined,
      }));

    // Replace all field schemas for this org + object type
    await p.fieldSchema.deleteMany({
      where: { orgId, objectType: crmObjectType },
    });

    if (fields.length > 0) {
      await p.fieldSchema.createMany({ data: fields });
    }

    totalSynced += fields.length;
  }

  // Update org timestamp
  await p.organization.update({
    where: { id: orgId },
    data: { fieldsSyncedAt: new Date() },
  });

  return totalSynced;
}
