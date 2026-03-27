import { randomUUID } from "node:crypto";

export function parseCsv(
  csv: string,
  recordIdColumn = "Id"
): Array<{ recordId: string; fields: Record<string, unknown> }> {
  // Strip BOM
  if (csv.charCodeAt(0) === 0xfeff) csv = csv.slice(1);

  const rows = splitCsvRows(csv);
  if (rows.length < 2) throw new Error("CSV must have a header row and at least one data row");

  const headers = parseCsvLine(rows[0]);
  const idColIndex = headers.findIndex(
    (h) => h.trim().toLowerCase() === recordIdColumn.toLowerCase()
  );
  const batchId = randomUUID().slice(0, 8);

  return rows.slice(1).filter(row => row.trim()).map((row, i) => {
    const values = parseCsvLine(row);
    const fields: Record<string, unknown> = {};
    headers.forEach((header, j) => {
      const key = header.trim();
      if (key && j < values.length) {
        fields[key] = values[j];
      }
    });

    const recordId =
      idColIndex >= 0 && values[idColIndex]?.trim()
        ? values[idColIndex].trim()
        : `mcp-${batchId}-${i + 1}`;

    return { recordId, fields };
  });
}

function splitCsvRows(csv: string): string[] {
  const rows: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && csv[i + 1] === "\n") i++; // Skip CRLF
      rows.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) rows.push(current);
  return rows;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}
