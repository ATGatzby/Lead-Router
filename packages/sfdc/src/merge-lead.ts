import type { Connection } from "jsforce";

/**
 * Merge a duplicate Lead into an existing master Lead via Salesforce SOAP API.
 *
 * @param conn          jsforce Connection
 * @param masterLeadId  The existing Lead that should be preserved (master record)
 * @param duplicateLeadId  The newly created Lead to merge in (will be deleted/converted)
 */
export async function mergeLead(
  conn: Connection,
  masterLeadId: string,
  duplicateLeadId: string
): Promise<void> {
  // jsforce SOAP merge sends malformed XML (null master record) — use Apex directly
  await mergeLeadViaApex(conn, masterLeadId, duplicateLeadId);
}

/** Fallback: execute Lead merge via Apex anonymous */
async function mergeLeadViaApex(
  conn: Connection,
  masterLeadId: string,
  duplicateLeadId: string
): Promise<void> {
  const apex = `
Database.MergeResult[] results = Database.merge(
  new Lead(Id = '${masterLeadId}'),
  new List<Id>{ '${duplicateLeadId}' },
  false
);
if (!results[0].isSuccess()) {
  throw new DmlException('Lead merge failed: ' + results[0].getErrors()[0].getMessage());
}
  `.trim();

  const result = await (conn as any).tooling.executeAnonymous(apex);

  if (!result.success) {
    const message = result.compileProblem ?? result.exceptionMessage ?? "Apex Lead merge failed";
    throw new Error(message);
  }
}
