// Client
export { HubSpotClient } from './client';
export type { HubSpotClientOptions } from './client';

// OAuth
export {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getTokenInfo,
  revokeToken,
} from './oauth';

// API classes
export { CrmApi } from './crm';
export { SearchApi } from './search';
export { PropertiesApi } from './properties';
export { OwnersApi } from './owners';
export { WebhooksApi } from './webhooks';
export { MergeApi } from './merge';
export { ExportApi } from './export';

// Errors
export { HubSpotError, HubSpotRateLimitError, HubSpotAuthError } from './errors';

// Types
export type {
  CrmObjectType,
  OAuthTokenResponse,
  OAuthTokenInfo,
  CrmObject,
  CrmObjectInput,
  Association,
  SearchRequest,
  FilterGroup,
  Filter,
  FilterOperator,
  SearchResponse,
  CrmProperty,
  PropertyOption,
  HubSpotOwner,
  WebhookSubscription,
  WebhookEvent,
  BatchReadRequest,
  BatchResponse,
  MergeRequest,
  PaginatedResponse,
  HubSpotApiError,
  BatchUpdateRequest,
  BatchUpdateResponse,
  ExportRequest,
  ExportStatus,
  RateLimitInfo,
} from './types';
