/**
 * Sanitize a cell value to prevent CSV formula injection.
 * Prefixes dangerous characters with a single quote.
 */
export function sanitizeCsvCell(value: string): string {
  if (!value) return value;
  const dangerousChars = ["=", "+", "-", "@", "\t", "\r"];
  if (dangerousChars.some((c) => value.startsWith(c))) {
    return "'" + value;
  }
  return value;
}

/**
 * Sanitize all string values in a row for CSV export.
 */
export function sanitizeCsvRow(row: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    const str = value == null ? "" : String(value);
    result[key] = sanitizeCsvCell(str);
  }
  return result;
}
