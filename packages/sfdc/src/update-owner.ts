import type { Connection } from "jsforce";

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
