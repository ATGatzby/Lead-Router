import type { Connection } from "jsforce";

export interface BulkUpdateRecord {
  Id: string;
  OwnerId: string;
  [key: string]: string | undefined; // allows routing action field
}

export interface BulkUpdateResult {
  successful: string[]; // record IDs that were updated
  failed: Array<{ id: string; error: string }>;
  unprocessed: number;
}

/**
 * Update the OwnerId of a Salesforce record.
 * Also stamps Routing_Action__c to prevent recursive trigger firing.
 * ownerId can be a User ID (005...) or Queue ID (00G...).
 *
 * If the routing action field doesn't exist in the org (INVALID_FIELD),
 * retries without it — Layer 2 is optional until the field is deployed.
 */
export async function updateOwner(
  conn: Connection,
  objectType: string,
  recordId: string,
  ownerId: string,
  routingActionField?: string
): Promise<void> {
  const data: Record<string, string> = { Id: recordId, OwnerId: ownerId };
  if (routingActionField) {
    data[routingActionField] = `assigned:${new Date().toISOString()}`;
  }
  try {
    await conn.sobject(objectType).update(data as Record<string, string> & { Id: string });
  } catch (err: any) {
    // If the routing action field doesn't exist yet, retry without it
    if (routingActionField && err?.errorCode === "INVALID_FIELD") {
      const fallback: Record<string, string> = { Id: recordId, OwnerId: ownerId };
      await conn.sobject(objectType).update(fallback as Record<string, string> & { Id: string });
      return;
    }
    throw err;
  }
}

/**
 * Bulk-update OwnerId for multiple Salesforce records using the Bulk API 2.0.
 * Stamps the routing action field on each record to prevent recursive triggers.
 *
 * If ALL records fail with INVALID_FIELD (routing action field doesn't exist),
 * retries the entire batch without the field.
 */
export async function bulkUpdateOwners(
  conn: Connection,
  objectType: string,
  records: BulkUpdateRecord[],
  routingActionField?: string
): Promise<BulkUpdateResult> {
  if (records.length === 0) {
    return { successful: [], failed: [], unprocessed: 0 };
  }

  // Stamp routing action field on each record
  if (routingActionField) {
    const stamp = `assigned:${new Date().toISOString()}`;
    for (const rec of records) {
      if (!rec[routingActionField]) {
        rec[routingActionField] = stamp;
      }
    }
  }

  const result = await executeBulkUpdate(conn, objectType, records);

  // If ALL records failed with INVALID_FIELD, retry without the routing action field
  if (
    routingActionField &&
    result.successful.length === 0 &&
    result.failed.length > 0 &&
    result.failed.every((f) => f.error.includes("INVALID_FIELD"))
  ) {
    // Strip the routing action field from all records
    for (const rec of records) {
      delete rec[routingActionField];
    }
    const retryResult = await executeBulkUpdate(conn, objectType, records);
    console.log(
      `[bulk-update] ${objectType}: ${retryResult.successful.length} succeeded, ${retryResult.failed.length} failed, ${retryResult.unprocessed} unprocessed (retried without ${routingActionField})`
    );
    return retryResult;
  }

  console.log(
    `[bulk-update] ${objectType}: ${result.successful.length} succeeded, ${result.failed.length} failed, ${result.unprocessed} unprocessed`
  );
  return result;
}

async function executeBulkUpdate(
  conn: Connection,
  objectType: string,
  records: BulkUpdateRecord[]
): Promise<BulkUpdateResult> {
  const res = await (conn as any).bulk2.loadAndWaitForResults({
    object: objectType,
    operation: "update",
    input: records,
    pollTimeout: 300_000,
    pollInterval: 5_000,
  });

  const successful: string[] = [];
  const failed: Array<{ id: string; error: string }> = [];

  if (res.successfulResults) {
    for (const r of res.successfulResults) {
      successful.push(r.sf__Id);
    }
  }

  if (res.failedResults) {
    for (const r of res.failedResults) {
      failed.push({ id: r.sf__Id, error: r.sf__Error });
    }
  }

  const unprocessed = res.unprocessedRecords?.length ?? 0;

  return { successful, failed, unprocessed };
}
