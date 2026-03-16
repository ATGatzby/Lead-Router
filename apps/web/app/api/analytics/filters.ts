export interface AnalyticsFilters {
  fromDate: Date;
  toDate: Date;
  ruleId: string | null;
  teamId: string | null;
  assigneeId: string | null;
  objectType: string | null;
}

/**
 * Parse shared filter query params used by all analytics endpoints.
 * Defaults to the last 30 days when `from`/`to` are omitted.
 */
export function parseFilters(params: URLSearchParams): AnalyticsFilters {
  const from = params.get("from");
  const to = params.get("to");
  const ruleId = params.get("ruleId") || null;
  const teamId = params.get("teamId") || null;
  const assigneeId = params.get("assigneeId") || null;
  const objectType = params.get("objectType") || null;

  let fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000);
  let toDate = to ? new Date(to) : new Date();

  // Fall back to defaults for invalid date strings
  if (isNaN(fromDate.getTime())) fromDate = new Date(Date.now() - 30 * 86_400_000);
  if (isNaN(toDate.getTime())) toDate = new Date();

  fromDate.setUTCHours(0, 0, 0, 0);
  toDate.setUTCHours(23, 59, 59, 999);

  return { fromDate, toDate, ruleId, teamId, assigneeId, objectType };
}

/**
 * Build a WHERE clause and parameter array for querying routing_daily_aggregates.
 *
 * Dimension hierarchy (most-specific wins):
 *   assigneeId > teamId > ruleId > org-level
 *
 * Returns positional placeholders starting at $1.
 */
export function buildAggregateQuery(
  orgId: string,
  filters: AnalyticsFilters,
): { where: string; params: unknown[] } {
  const { fromDate, toDate, ruleId, teamId, assigneeId, objectType } = filters;
  const params: unknown[] = [orgId, fromDate, toDate];
  let where = '"orgId" = $1 AND date >= $2 AND date <= $3';
  let idx = 4;

  if (assigneeId) {
    where += ` AND "assigneeId" = $${idx++}`;
    params.push(assigneeId);
  } else if (teamId) {
    where += ` AND "teamId" = $${idx++} AND "assigneeId" IS NULL`;
    params.push(teamId);
  } else if (ruleId) {
    where += ` AND "ruleId" = $${idx++} AND "pathLabel" IS NULL AND "teamId" IS NULL AND "assigneeId" IS NULL`;
    params.push(ruleId);
  } else {
    where += ' AND "ruleId" IS NULL AND "teamId" IS NULL AND "assigneeId" IS NULL';
  }

  if (objectType) {
    where += ` AND "objectType" = $${idx++}::"SfdcObjectType"`;
    params.push(objectType);
  }

  return { where, params };
}
