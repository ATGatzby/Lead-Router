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
  // jsforce v2 exposes SOAP merge via conn.soap.merge()
  // Signature: conn.soap.merge(type, mergeRequests)
  try {
    const result = await (conn as any).soap.merge("Lead", [
      {
        masterRecord: { Id: masterLeadId },
        recordToMergeIds: [duplicateLeadId],
      },
    ]);

    const mergeResult = Array.isArray(result) ? result[0] : result;
    if (!mergeResult?.success) {
      const errors = mergeResult?.errors ?? [];
      const message = Array.isArray(errors) && errors.length > 0
        ? errors.map((e: any) => e.message ?? String(e)).join("; ")
        : "Lead merge failed with no error details";
      throw new Error(message);
    }
  } catch (err: any) {
    // If SOAP merge is not available, fall back to Apex anonymous execution
    if (err?.message?.includes("is not a function") || err?.name === "TypeError") {
      await mergeLeadViaApex(conn, masterLeadId, duplicateLeadId);
    } else {
      throw err;
    }
  }
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
