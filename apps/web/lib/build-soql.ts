/**
 * Converts search criteria JSON into a SOQL query string.
 * Used by the scheduled route run endpoint to query Salesforce.
 */

export interface SearchCriterion {
  field: string;
  operator: string;
  value: string;
}

/** SOQL date literals that must NOT be quoted */
const DATE_LITERAL_RE =
  /^(TODAY|YESTERDAY|TOMORROW|LAST_WEEK|THIS_WEEK|NEXT_WEEK|LAST_MONTH|THIS_MONTH|NEXT_MONTH|LAST_QUARTER|THIS_QUARTER|NEXT_QUARTER|LAST_YEAR|THIS_YEAR|NEXT_YEAR|LAST_N_DAYS:\d+|NEXT_N_DAYS:\d+|LAST_N_WEEKS:\d+|NEXT_N_WEEKS:\d+|LAST_N_MONTHS:\d+|NEXT_N_MONTHS:\d+|LAST_N_QUARTERS:\d+|NEXT_N_QUARTERS:\d+|LAST_N_YEARS:\d+|NEXT_N_YEARS:\d+|LAST_90_DAYS|LAST_N_FISCAL_QUARTERS:\d+|LAST_N_FISCAL_YEARS:\d+)$/i;

/** Numeric value (integer or decimal, optionally negative) */
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

const DEFAULT_LIMIT = 2000;

/** Default fields by object type */
const DEFAULT_FIELDS: Record<string, string[]> = {
  Lead: ["Id", "OwnerId", "Name", "Email"],
  Contact: ["Id", "OwnerId", "Name", "Email"],
  Account: ["Id", "OwnerId", "Name"],
};

/** Escape single quotes for SOQL injection prevention */
function escapeSOQL(value: string): string {
  return value.replace(/'/g, "\\'");
}

/** Check if a value should be treated as unquoted (number or date literal) */
function isUnquotedValue(value: string): boolean {
  return NUMERIC_RE.test(value) || DATE_LITERAL_RE.test(value);
}

/** Wrap a value in SOQL single quotes, unless it's numeric or a date literal */
function quoteValue(value: string): string {
  if (isUnquotedValue(value)) return value;
  return `'${escapeSOQL(value)}'`;
}

/**
 * Convert a single search criterion to a SOQL WHERE clause fragment.
 */
function criterionToClause(c: SearchCriterion): string {
  const { field, operator, value } = c;

  switch (operator) {
    case "equals":
      return `${field} = ${quoteValue(value)}`;

    case "not_equals":
      return `${field} != ${quoteValue(value)}`;

    case "contains":
      return `${field} LIKE '%${escapeSOQL(value)}%'`;

    case "not_contains":
      return `(NOT ${field} LIKE '%${escapeSOQL(value)}%')`;

    case "starts_with":
      return `${field} LIKE '${escapeSOQL(value)}%'`;

    case "greater_than":
    case "gt":
      return `${field} > ${quoteValue(value)}`;

    case "less_than":
    case "lt":
      return `${field} < ${quoteValue(value)}`;

    case "gte":
      return `${field} >= ${quoteValue(value)}`;

    case "lte":
      return `${field} <= ${quoteValue(value)}`;

    case "in": {
      const items = value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => `'${escapeSOQL(v)}'`)
        .join(",");
      return `${field} IN (${items})`;
    }

    case "not_in": {
      const items = value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .map((v) => `'${escapeSOQL(v)}'`)
        .join(",");
      return `${field} NOT IN (${items})`;
    }

    case "is_blank":
      return `${field} = null`;

    case "is_not_blank":
      return `${field} != null`;

    case "is_true":
      return `${field} = true`;

    case "is_false":
      return `${field} = false`;

    case "before":
      return `${field} < ${quoteValue(value)}`;

    case "after":
      return `${field} > ${quoteValue(value)}`;

    case "within_last": {
      const days = /^\d+$/.test(value) ? value : "1";
      return `${field} >= LAST_N_DAYS:${days}`;
    }

    default:
      // Fallback: treat unknown operators as equals
      return `${field} = ${quoteValue(value)}`;
  }
}

/**
 * Build a SOQL query from search criteria.
 *
 * @param objectType - Salesforce object API name (e.g. "Lead", "Contact", "Account")
 * @param criteria   - Array of search criteria (field/operator/value)
 * @param fields     - Optional list of fields to SELECT (defaults based on objectType)
 * @param limit      - Max records (default 2000, Salesforce governor limit)
 */
export function buildSoqlFromCriteria(
  objectType: string,
  criteria: SearchCriterion[],
  fields?: string[],
  limit: number = DEFAULT_LIMIT
): string {
  const selectFields =
    fields && fields.length > 0
      ? fields
      : DEFAULT_FIELDS[objectType] ?? ["Id", "OwnerId", "Name"];

  const selectClause = `SELECT ${selectFields.join(", ")} FROM ${objectType}`;

  // Operators that don't need a value
  const noValueOps = new Set(["is_blank", "is_not_blank", "is_true", "is_false"]);

  const validCriteria = criteria.filter(
    (c) => c.field && c.operator && (noValueOps.has(c.operator) || (c.value !== undefined && c.value !== ""))
  );

  // Exclude converted leads — SFDC rejects owner updates on converted records
  // Skip if user already has an explicit IsConverted condition
  const hasExplicitConvertedFilter = validCriteria.some((c) => c.field === "IsConverted");
  const convertedFilter = objectType === "Lead" && !hasExplicitConvertedFilter ? "IsConverted = false" : "";

  if (validCriteria.length === 0) {
    return convertedFilter
      ? `${selectClause} WHERE ${convertedFilter} LIMIT ${limit}`
      : `${selectClause} LIMIT ${limit}`;
  }

  const whereClauses = validCriteria.map(criterionToClause);
  if (convertedFilter) whereClauses.push(convertedFilter);
  return `${selectClause} WHERE ${whereClauses.join(" AND ")} LIMIT ${limit}`;
}
