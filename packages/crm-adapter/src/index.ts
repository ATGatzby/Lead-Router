export type { CrmAdapter, CrmType, BulkUpdateResult } from "./types.js";
export { SalesforceAdapter } from "./salesforce-adapter.js";
export { HubSpotAdapter } from "./hubspot-adapter.js";
export { getCrmAdapter, evictCrmAdapter } from "./factory.js";
