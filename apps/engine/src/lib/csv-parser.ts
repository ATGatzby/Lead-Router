import { createInterface } from "node:readline";
import { Readable } from "node:stream";

/**
 * Parse a single CSV row handling RFC 4180:
 * - Quoted fields with embedded commas
 * - Escaped quotes (doubled "")
 * - Newlines within quoted fields are handled by readline (crlfDelay)
 */
export function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current);
        current = "";
      } else {
        current += char;
      }
    }
  }
  result.push(current);
  return result;
}

/**
 * Stream-parse a CSV ReadableStream into batches of records.
 * Yields arrays of { recordId, fields } objects.
 *
 * Memory usage: O(batchSize) regardless of total file size.
 *
 * @param readable - Web ReadableStream<Uint8Array> (e.g., from fetch response.body)
 * @param batchSize - Number of records per yielded batch (default 500)
 * @param columnRenameMap - Optional map of display name → API name for header normalization.
 *   HubSpot Export API returns display names ("First Name") but conditions use API names ("firstname").
 */
export async function* streamCSVRecords(
  readable: ReadableStream<Uint8Array>,
  batchSize: number = 500,
  columnRenameMap?: Map<string, string>,
): AsyncGenerator<Array<{ recordId: string; fields: Record<string, unknown> }>> {
  const nodeStream = Readable.fromWeb(readable as any);
  const rl = createInterface({ input: nodeStream, crlfDelay: Infinity });

  let headers: string[] | null = null;
  let batch: Array<{ recordId: string; fields: Record<string, unknown> }> = [];

  for await (const line of rl) {
    if (!line.trim()) continue;

    if (!headers) {
      const rawHeaders = parseCSVRow(line);
      // Rename display names to API names if a map is provided
      headers = columnRenameMap
        ? rawHeaders.map((h) => columnRenameMap.get(h) ?? h)
        : rawHeaders;
      continue;
    }

    const values = parseCSVRow(line);
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      fields[headers[i]] = values[i] ?? "";
    }

    // HubSpot exports use "hs_object_id" or "Record ID" for the object ID
    const recordId = String(
      fields["hs_object_id"] ?? fields["Record ID"] ?? fields["id"] ?? ""
    );
    if (!recordId) continue;

    batch.push({ recordId, fields });

    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }

  if (batch.length > 0) {
    yield batch;
  }
}
