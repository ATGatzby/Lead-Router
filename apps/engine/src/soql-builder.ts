// ─── SOQL Builder ──────────────────────────────────────────────────────────
// Converts UI condition groups into a Salesforce SOQL query.
// Groups use AND within, OR between groups (same logic as the evaluator).

interface SOQLCondition {
  fieldApiName: string;
  fieldType?: string;
  operator: string;
  value: string | null;
}

interface SOQLConditionGroup {
  id: string;
  conditions: SOQLCondition[];
}

// Standard fields to SELECT per object type
const STANDARD_FIELDS: Record<string, string> = {
  LEAD: "Id, Name, Email, Phone, Company, Title, LeadSource, Status, Rating, Industry, AnnualRevenue, NumberOfEmployees, State, Country, OwnerId, CreatedDate, LastModifiedDate",
  CONTACT: "Id, Name, Email, Phone, Title, Department, AccountId, OwnerId, CreatedDate, LastModifiedDate",
  ACCOUNT: "Id, Name, Phone, Industry, AnnualRevenue, NumberOfEmployees, BillingState, BillingCountry, OwnerId, CreatedDate, LastModifiedDate",
};

function objectName(objectType: string): string {
  return objectType === "LEAD" ? "Lead" : objectType === "CONTACT" ? "Contact" : "Account";
}

/**
 * Build a complete SOQL query from search criteria.
 * Returns e.g.: SELECT Id, Name, ... FROM Lead WHERE Status = 'Open' AND Rating = 'Hot' LIMIT 50000
 */
export function buildSearchSOQL(
  objectType: string,
  criteria: SOQLConditionGroup[] | null,
  limit: number = 50000,
  omitLimit: boolean = false
): string {
  const obj = objectName(objectType);
  const fields = STANDARD_FIELDS[objectType] ?? STANDARD_FIELDS.LEAD;
  const suffix = omitLimit ? " ORDER BY Id ASC" : ` LIMIT ${limit}`;

  if (!criteria || criteria.length === 0) {
    // Exclude converted leads — SFDC rejects owner updates on converted records
    const convertedFilter = obj === "Lead" ? " WHERE IsConverted = false" : "";
    return `SELECT ${fields} FROM ${obj}${convertedFilter}${suffix}`;
  }

  const groupClauses = criteria.map((group) => {
    const conds = group.conditions.map((c) => conditionToSOQL(c));
    return conds.length === 1 ? conds[0] : `(${conds.join(" AND ")})`;
  });

  const where = groupClauses.length === 1 ? groupClauses[0] : groupClauses.join(" OR ");

  // Exclude converted leads — SFDC rejects owner updates on converted records
  const convertedFilter = obj === "Lead" ? " AND IsConverted = false" : "";

  return `SELECT ${fields} FROM ${obj} WHERE ${where}${convertedFilter}${suffix}`;
}

/**
 * Build a COUNT query (for preview without fetching all records).
 */
export function buildCountSOQL(
  objectType: string,
  criteria: SOQLConditionGroup[] | null
): string {
  const obj = objectName(objectType);

  if (!criteria || criteria.length === 0) {
    const convertedFilter = obj === "Lead" ? " WHERE IsConverted = false" : "";
    return `SELECT COUNT() FROM ${obj}${convertedFilter}`;
  }

  const groupClauses = criteria.map((group) => {
    const conds = group.conditions.map((c) => conditionToSOQL(c));
    return conds.length === 1 ? conds[0] : `(${conds.join(" AND ")})`;
  });

  const where = groupClauses.length === 1 ? groupClauses[0] : groupClauses.join(" OR ");

  const convertedFilter = obj === "Lead" ? " AND IsConverted = false" : "";

  return `SELECT COUNT() FROM ${obj} WHERE ${where}${convertedFilter}`;
}

// ─── Condition → SOQL clause ──────────────────────────────────────────────

const NUMERIC_TYPES = new Set(["NUMBER", "CURRENCY", "PERCENT", "DOUBLE"]);
const DATE_TYPES = new Set(["DATE", "DATETIME"]);

function isNumericField(cond: SOQLCondition): boolean {
  return NUMERIC_TYPES.has(cond.fieldType?.toUpperCase() ?? "");
}

function isDateField(cond: SOQLCondition): boolean {
  return DATE_TYPES.has(cond.fieldType?.toUpperCase() ?? "");
}

/** Check if value looks like a SOQL date literal (e.g. LAST_N_DAYS:7, TODAY, YESTERDAY) */
function isDateLiteral(value: string): boolean {
  return /^(TODAY|YESTERDAY|TOMORROW|LAST_N_DAYS:\d+|NEXT_N_DAYS:\d+|LAST_WEEK|THIS_WEEK|NEXT_WEEK|LAST_MONTH|THIS_MONTH|NEXT_MONTH|LAST_90_DAYS|LAST_N_MONTHS:\d+|NEXT_N_MONTHS:\d+|THIS_YEAR|LAST_YEAR|NEXT_YEAR|LAST_N_YEARS:\d+|NEXT_N_YEARS:\d+)$/i.test(value);
}

function conditionToSOQL(cond: SOQLCondition): string {
  const field = escapeSoqlField(cond.fieldApiName);
  const value = cond.value ?? "";
  const escaped = escapeSoqlValue(value);
  const isNumeric = isNumericField(cond) || /^\d+(\.\d+)?$/.test(value);
  const isDate = isDateField(cond) || isDateLiteral(value);
  const needsQuotes = !isNumeric && !isDate;

  switch (cond.operator) {
    case "equals":
      return needsQuotes ? `${field} = '${escaped}'` : `${field} = ${value}`;
    case "not_equals":
      return needsQuotes ? `${field} != '${escaped}'` : `${field} != ${value}`;
    case "contains":
      return `${field} LIKE '%${escaped}%'`;
    case "not_contains":
      return `NOT ${field} LIKE '%${escaped}%'`;
    case "starts_with":
      return `${field} LIKE '${escaped}%'`;
    case "greater_than":
    case "gt":
      return needsQuotes ? `${field} > '${escaped}'` : `${field} > ${value}`;
    case "less_than":
    case "lt":
      return needsQuotes ? `${field} < '${escaped}'` : `${field} < ${value}`;
    case "gte":
      return needsQuotes ? `${field} >= '${escaped}'` : `${field} >= ${value}`;
    case "lte":
      return needsQuotes ? `${field} <= '${escaped}'` : `${field} <= ${value}`;
    case "is_blank":
      return `${field} = null`;
    case "is_not_blank":
      return `${field} != null`;
    case "in":
      return `${field} IN (${value
        .split(",")
        .map((v) => `'${escapeSoqlValue(v.trim())}'`)
        .join(", ")})`;
    case "not_in":
      return `${field} NOT IN (${value
        .split(",")
        .map((v) => `'${escapeSoqlValue(v.trim())}'`)
        .join(", ")})`;
    case "is_true":
      return `${field} = true`;
    case "is_false":
      return `${field} = false`;
    default:
      return needsQuotes ? `${field} = '${escaped}'` : `${field} = ${value}`;
  }
}

// ─── SOQL escaping ────────────────────────────────────────────────────────

/** Escape a SOQL field name — only allow alphanumeric + underscore + dot */
export function escapeSoqlField(field: string): string {
  return field.replace(/[^a-zA-Z0-9_.]/g, "");
}

/** Escape a SOQL string value to prevent injection */
export function escapeSoqlValue(val: string): string {
  return val
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}
