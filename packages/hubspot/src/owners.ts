import type { HubSpotClient } from './client';
import type { HubSpotOwner, PaginatedResponse } from './types';

/**
 * Owners API — list and retrieve HubSpot users who can own CRM records.
 */
export class OwnersApi {
  constructor(private client: HubSpotClient) {}

  /**
   * List owners with optional filtering and pagination.
   *
   * @param options.email - Filter by owner email address.
   * @param options.after - Cursor for the next page.
   * @param options.limit - Number of results per page (max 500).
   */
  async listOwners(options?: {
    email?: string;
    after?: string;
    limit?: number;
  }): Promise<PaginatedResponse<HubSpotOwner>> {
    const query: Record<string, string> = {};
    if (options?.email) query.email = options.email;
    if (options?.after) query.after = options.after;
    if (options?.limit) query.limit = String(options.limit);

    return this.client.get<PaginatedResponse<HubSpotOwner>>(
      '/crm/v3/owners',
      Object.keys(query).length > 0 ? query : undefined,
    );
  }

  /**
   * Auto-paginate through all owners in the portal.
   */
  async listAllOwners(): Promise<HubSpotOwner[]> {
    const allOwners: HubSpotOwner[] = [];
    let after: string | undefined = undefined;

    while (true) {
      const page = await this.listOwners({ after, limit: 500 });
      allOwners.push(...page.results);

      if (!page.paging?.next?.after) {
        break;
      }

      after = page.paging.next.after;
    }

    return allOwners;
  }

  /**
   * Get a single owner by ID.
   *
   * @param ownerId - The owner's ID.
   */
  async getOwner(ownerId: string): Promise<HubSpotOwner> {
    return this.client.get<HubSpotOwner>(`/crm/v3/owners/${ownerId}`);
  }
}
