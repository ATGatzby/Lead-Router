import type { HubSpotClient } from './client';
import type {
  CrmObjectType,
  CrmObject,
  CrmObjectInput,
  BatchReadRequest,
  BatchResponse,
  BatchUpdateRequest,
  BatchUpdateResponse,
} from './types';

/**
 * CRUD and batch operations on HubSpot CRM objects
 * (contacts, companies, deals).
 */
export class CrmApi {
  constructor(private client: HubSpotClient) {}

  /**
   * Fetch a single CRM object by ID.
   *
   * @param objectType - The CRM object type.
   * @param id         - The object ID.
   * @param properties - Optional list of property names to include.
   */
  async getObject(
    objectType: CrmObjectType,
    id: string,
    properties?: string[],
  ): Promise<CrmObject> {
    const query: Record<string, string> | undefined = properties
      ? { properties: properties.join(',') }
      : undefined;
    return this.client.get<CrmObject>(
      `/crm/v3/objects/${objectType}/${id}`,
      query,
    );
  }

  /**
   * Create a new CRM object.
   *
   * @param objectType - The CRM object type.
   * @param input      - Properties (and optional associations) for the new record.
   */
  async createObject(
    objectType: CrmObjectType,
    input: CrmObjectInput,
  ): Promise<CrmObject> {
    return this.client.post<CrmObject>(
      `/crm/v3/objects/${objectType}`,
      input,
    );
  }

  /**
   * Update an existing CRM object's properties.
   *
   * @param objectType - The CRM object type.
   * @param id         - The object ID.
   * @param properties - Key-value pairs to update.
   */
  async updateObject(
    objectType: CrmObjectType,
    id: string,
    properties: Record<string, string>,
  ): Promise<CrmObject> {
    return this.client.patch<CrmObject>(
      `/crm/v3/objects/${objectType}/${id}`,
      { properties },
    );
  }

  /**
   * Archive (soft-delete) a CRM object.
   *
   * @param objectType - The CRM object type.
   * @param id         - The object ID.
   */
  async deleteObject(objectType: CrmObjectType, id: string): Promise<void> {
    await this.client.delete(`/crm/v3/objects/${objectType}/${id}`);
  }

  /**
   * Read a batch of CRM objects by their IDs.
   *
   * @param objectType - The CRM object type.
   * @param request    - IDs and optional properties to fetch.
   */
  async batchRead(
    objectType: CrmObjectType,
    request: BatchReadRequest,
  ): Promise<BatchResponse> {
    return this.client.post<BatchResponse>(
      `/crm/v3/objects/${objectType}/batch/read`,
      request,
    );
  }

  /**
   * Update a batch of CRM objects by their IDs.
   *
   * @param objectType - The CRM object type.
   * @param request    - IDs and properties to update.
   */
  async batchUpdate(
    objectType: CrmObjectType,
    request: BatchUpdateRequest,
  ): Promise<BatchUpdateResponse> {
    return this.client.post<BatchUpdateResponse>(
      `/crm/v3/objects/${objectType}/batch/update`,
      request,
    );
  }
}
