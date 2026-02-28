import type { Connection } from "jsforce";

/**
 * Update the OwnerId of a Salesforce record.
 * ownerId can be a User ID (005...) or Queue ID (00G...).
 */
export async function updateOwner(
  conn: Connection,
  objectType: string, // 'Lead' | 'Contact' | 'Account'
  recordId: string,
  ownerId: string
): Promise<void> {
  await conn.sobject(objectType).update({ Id: recordId, OwnerId: ownerId });
}
