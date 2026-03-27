import type { EngineClient } from "../clients/engine-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";
import { parseCsv } from "../utils/csv-parser.js";

const CHUNK_SIZE = 200;

export const routeBatchTool = {
  name: "route_batch",
  description: "Route multiple Salesforce records in batch. Provide records directly or as CSV text. Records are chunked into groups of 200 and sent to the engine.",
  inputSchema: {
    type: "object" as const,
    properties: {
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT"],
        description: "Salesforce object type",
      },
      eventType: {
        type: "string",
        enum: ["INSERT", "UPDATE", "BOTH"],
        description: "Event type — use INSERT for new records, UPDATE for modified records",
      },
      records: {
        type: "array",
        description: "Array of { recordId, fields } objects",
        items: {
          type: "object",
          properties: {
            recordId: { type: "string" },
            fields: { type: "object" },
          },
          required: ["recordId", "fields"],
        },
      },
      csv: {
        type: "string",
        description: "CSV text with headers. Use this instead of records array for bulk data.",
      },
      recordIdColumn: {
        type: "string",
        description: "Column name for the record ID in CSV (defaults to 'Id')",
      },
      ruleId: {
        type: "string",
        description: "Optional: target a specific rule by ID",
      },
    },
    required: ["objectType", "eventType"],
  },
};

export async function handleRouteBatch(engine: EngineClient, logger: Logger, args: any) {
  const start = Date.now();
  const { objectType, eventType, csv, recordIdColumn, ruleId } = args;

  let records: Array<{ recordId: string; fields: Record<string, unknown> }> = args.records || [];

  if (csv) {
    records = parseCsv(csv, recordIdColumn);
  }

  if (records.length === 0) {
    return successResponse("No records provided. Supply either 'records' array or 'csv' text.");
  }

  // Chunk records
  const chunks: Array<typeof records> = [];
  for (let i = 0; i < records.length; i += CHUNK_SIZE) {
    chunks.push(records.slice(i, i + CHUNK_SIZE));
  }

  let totalAccepted = 0;
  let totalDuplicates = 0;
  const batchIds: string[] = [];

  for (const chunk of chunks) {
    const result = await engine.routeBatch({ objectType, eventType, records: chunk, ruleId });
    totalAccepted += result.accepted ?? chunk.length;
    totalDuplicates += result.duplicates ?? 0;
    if (result.batchId) batchIds.push(result.batchId);
  }

  const durationMs = Date.now() - start;
  logger.log({
    tool: "route_batch",
    action: "execute",
    input: { objectType, eventType, recordCount: records.length, chunks: chunks.length },
    result: { totalAccepted, totalDuplicates, batchIds },
    durationMs,
  });

  const lines = [
    "Batch routing complete.",
    `Total Records: ${records.length}`,
    `Chunks: ${chunks.length}`,
    `Accepted: ${totalAccepted}`,
    `Duplicates: ${totalDuplicates}`,
    `Latency: ${durationMs}ms`,
  ];
  if (batchIds.length) lines.push(`Batch IDs: ${batchIds.join(", ")}`);

  return successResponse(lines.join("\n"));
}
