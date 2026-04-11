import type { HubSpotClient } from './client';
import type {
  CrmObjectType,
  CrmObject,
  SearchRequest,
  SearchResponse,
} from './types';

/** Maximum number of results HubSpot will return from a single search. */
const SEARCH_TOTAL_LIMIT = 10_000;
/** Maximum page size allowed by the search endpoint. */
const SEARCH_PAGE_SIZE = 100;

/**
 * CRM Search API — query CRM objects with filters, sorts, and pagination.
 */
export class SearchApi {
  constructor(private client: HubSpotClient) {}

  /**
   * Execute a single search request.
   *
   * @param objectType - The CRM object type to search.
   * @param request    - Filter groups, sorts, properties, limit, and cursor.
   */
  async search(
    objectType: CrmObjectType,
    request: SearchRequest,
  ): Promise<SearchResponse> {
    return this.client.post<SearchResponse>(
      `/crm/v3/objects/${objectType}/search`,
      request,
    );
  }

  /**
   * Auto-paginate through all matching results (up to the HubSpot 10 000
   * result cap).
   *
   * @param objectType - The CRM object type to search.
   * @param request    - The search query (the `after` and `limit` fields are
   *                     managed internally).
   */
  async searchAll(
    objectType: CrmObjectType,
    request: SearchRequest,
  ): Promise<CrmObject[]> {
    const allResults: CrmObject[] = [];
    let after: string | undefined = undefined;

    while (allResults.length < SEARCH_TOTAL_LIMIT) {
      const page = await this.search(objectType, {
        ...request,
        limit: SEARCH_PAGE_SIZE,
        after,
      });

      allResults.push(...page.results);

      if (!page.paging?.next?.after) {
        break;
      }

      after = page.paging.next.after;
    }

    return allResults;
  }
}
