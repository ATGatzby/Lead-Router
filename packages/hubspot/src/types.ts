/** CRM object types supported by the HubSpot API. */
export type CrmObjectType = 'contacts' | 'companies' | 'deals';

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface OAuthTokenInfo {
  app_id: number;
  hub_id: number;
  user_id: number;
  scopes: string[];
  token_type: string;
}

// ---------------------------------------------------------------------------
// CRM Objects
// ---------------------------------------------------------------------------

export interface CrmObject {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface CrmObjectInput {
  properties: Record<string, string>;
  associations?: Association[];
}

export interface Association {
  to: { id: string };
  types: Array<{ associationCategory: string; associationTypeId: number }>;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchRequest {
  filterGroups: FilterGroup[];
  sorts?: Array<{ propertyName: string; direction: 'ASCENDING' | 'DESCENDING' }>;
  properties?: string[];
  limit?: number;
  after?: string;
}

export interface FilterGroup {
  filters: Filter[];
}

export interface Filter {
  propertyName: string;
  operator: FilterOperator;
  value?: string;
  values?: string[];
  /** Upper bound for BETWEEN operator. */
  highValue?: string;
}

export type FilterOperator =
  | 'EQ'
  | 'NEQ'
  | 'LT'
  | 'LTE'
  | 'GT'
  | 'GTE'
  | 'BETWEEN'
  | 'IN'
  | 'NOT_IN'
  | 'HAS_PROPERTY'
  | 'NOT_HAS_PROPERTY'
  | 'CONTAINS_TOKEN'
  | 'NOT_CONTAINS_TOKEN';

export interface SearchResponse {
  total: number;
  results: CrmObject[];
  paging?: { next?: { after: string } };
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export interface CrmProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string;
  options: PropertyOption[];
  hasUniqueValue: boolean;
  calculated: boolean;
  externalOptions: boolean;
  hidden: boolean;
  hubspotDefined: boolean;
  formField: boolean;
}

export interface PropertyOption {
  label: string;
  value: string;
  displayOrder: number;
  hidden: boolean;
}

// ---------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------

export interface HubSpotOwner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  userId: number;
  teams: Array<{ id: string; name: string }>;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookSubscription {
  id: number;
  subscriptionType: string;
  propertyName?: string;
  active: boolean;
  createdAt: string;
}

export interface WebhookEvent {
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  subscriptionType: string;
  attemptNumber: number;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
  changeSource: string;
  sourceId?: string;
}

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

export interface BatchReadRequest {
  inputs: Array<{ id: string }>;
  properties?: string[];
}

export interface BatchResponse {
  status: string;
  results: CrmObject[];
  errors?: Array<{ status: string; category: string; message: string }>;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

export interface MergeRequest {
  primaryObjectId: string;
  objectIdToMerge: string;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface PaginatedResponse<T> {
  results: T[];
  paging?: { next?: { after: string } };
}

// ---------------------------------------------------------------------------
// Rate Limit
// ---------------------------------------------------------------------------

/** Rate limit information parsed from HubSpot API response headers. */
export interface RateLimitInfo {
  /** Remaining requests in the current 10-second window. */
  remaining: number | null;
  /** Remaining daily API calls. */
  dailyRemaining: number | null;
  /** Rate limit interval in milliseconds (usually 10000). */
  intervalMs: number | null;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export interface HubSpotApiError {
  status: string;
  message: string;
  correlationId: string;
  category: string;
}

// ---------------------------------------------------------------------------
// Batch Update
// ---------------------------------------------------------------------------

export interface BatchUpdateRequest {
  inputs: Array<{
    id: string;
    properties: Record<string, string>;
    objectWriteTraceId?: string;
  }>;
}

export interface BatchUpdateResponse {
  status: string;
  results: CrmObject[];
  errors?: Array<{
    status: string;
    category: string;
    message: string;
    context?: Record<string, string[]>;
  }>;
  numErrors?: number;
}

// ---------------------------------------------------------------------------
// Export API
// ---------------------------------------------------------------------------

export interface ExportRequest {
  exportType: 'VIEW' | 'LIST';
  format: 'CSV' | 'XLSX' | 'XLS';
  exportName: string;
  objectType: string;
  objectProperties: string[];
  filterGroups?: FilterGroup[];
  language?: string;
}

export interface ExportStatus {
  id: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
  result?: string;
  totalRows?: number;
  createdAt?: string;
  updatedAt?: string;
}
