export type CrmType = "SALESFORCE" | "HUBSPOT";

export interface BulkUpdateResult {
  successIds: string[];
  failedIds: string[];
}

/**
 * Unified CRM adapter interface.
 * Both Salesforce and HubSpot implement this to allow the engine
 * to route records without knowing which CRM is behind the org.
 */
export interface CrmAdapter {
  readonly type: CrmType;

  // ── Owner resolution ─────────────────────────────────────────────
  /** Look up the CRM-specific owner ID for a user (SFDC User ID or HubSpot Owner ID) */
  getCrmOwnerId(userId: string, orgId: string): Promise<string | null>;

  /** Look up the CRM-specific queue ID (SFDC only — returns null for HubSpot) */
  getCrmQueueId(queueId: string, orgId: string): Promise<string | null>;

  // ── Single record operations ─────────────────────────────────────
  /** Update the owner of a CRM record */
  updateOwner(
    orgId: string,
    objectType: string,
    recordId: string,
    ownerId: string,
    actionField?: string,
  ): Promise<void>;

  /** Update arbitrary fields on a CRM record */
  updateFields(
    orgId: string,
    objectType: string,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<void>;

  // ── Bulk operations ──────────────────────────────────────────────
  /** Batch update owners on multiple records */
  batchUpdateOwners(
    orgId: string,
    objectType: string,
    assignments: Array<{ recordId: string; ownerId: string }>,
  ): Promise<BulkUpdateResult>;

  // ── Object type helpers ──────────────────────────────────────────
  /** Convert internal enum (e.g. "LEAD") to CRM API name (e.g. "Lead" or "contacts") */
  toCrmObjectName(objectType: string): string;

  /** Get the list of object types this CRM supports */
  getSupportedObjectTypes(): string[];

  /** Whether this CRM supports queue assignment */
  supportsQueues(): boolean;

  /** Whether this CRM supports lead merging */
  supportsMerge(): boolean;
}
