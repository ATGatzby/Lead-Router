import type { HubSpotClient } from './client';
import type { CrmObjectType, CrmProperty } from './types';

/**
 * Properties API — retrieve field metadata for CRM object types.
 */
export class PropertiesApi {
  constructor(private client: HubSpotClient) {}

  /**
   * List all properties defined on a CRM object type.
   *
   * @param objectType - The CRM object type (contacts, companies, deals).
   */
  async listProperties(objectType: CrmObjectType): Promise<CrmProperty[]> {
    const res = await this.client.get<{ results: CrmProperty[] }>(
      `/crm/v3/properties/${objectType}`,
    );
    return res.results;
  }

  /**
   * Get a single property definition by name.
   *
   * @param objectType   - The CRM object type.
   * @param propertyName - The internal property name.
   */
  async getProperty(
    objectType: CrmObjectType,
    propertyName: string,
  ): Promise<CrmProperty> {
    return this.client.get<CrmProperty>(
      `/crm/v3/properties/${objectType}/${propertyName}`,
    );
  }
}
