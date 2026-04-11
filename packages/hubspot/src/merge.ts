import type { HubSpotClient } from './client';
import type { CrmObjectType, CrmObject, MergeRequest } from './types';

/**
 * Merge API — combine duplicate CRM records.
 */
export class MergeApi {
  constructor(private client: HubSpotClient) {}

  /**
   * Merge two CRM objects of the same type. The primary object survives and
   * the secondary object is archived.
   *
   * @param objectType - The CRM object type.
   * @param request    - Primary and secondary object IDs.
   */
  async merge(
    objectType: CrmObjectType,
    request: MergeRequest,
  ): Promise<CrmObject> {
    return this.client.post<CrmObject>(
      `/crm/v3/objects/${objectType}/merge`,
      request,
    );
  }
}
