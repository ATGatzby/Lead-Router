import { prisma } from "@lead-routing/db";
import { getActiveRules, type CachedRule } from "./cache.js";
import { buildSearchSOQL, buildCountSOQL } from "./soql-builder.js";
import { routeRecord } from "./router.js";
import { getOrgConnection } from "./sfdc.js";
import { runBulkSearch } from "./bulk-search.js";

const BULK_THRESHOLD = 2000;

export interface RunResult {
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED" | "CANCELLED";
  recordsFound?: number;
  recordsRouted?: number;
  recordsFailed?: number;
  durationMs?: number;
  error?: string;
}

export async function runScheduledRoute(ruleId: string, orgId: string): Promise<RunResult> {
  const startTime = Date.now();

  // 1. Load rule from DB (need fresh data for searchCriteria)
  const rule = await prisma.routingRule.findFirst({
    where: { id: ruleId, orgId, status: "ACTIVE" },
  });
  if (!rule) return { status: "SKIPPED", error: "Rule not found or inactive" };
  if ((rule as any).routeType !== "SCHEDULED") return { status: "SKIPPED", error: "Not a scheduled route" };

  const searchCriteria = (rule as any).searchCriteria as CachedRule["searchCriteria"];

  try {
    // 2. Get SFDC connection
    const conn = await getOrgConnection(orgId);

    // 3. Run COUNT query to determine path (REST vs Bulk)
    const countSoql = buildCountSOQL(rule.objectType, searchCriteria);
    const countResult = await conn.query(countSoql);
    const totalCount = countResult.totalSize;
    console.log(`[search-runner] Rule ${ruleId}: COUNT = ${totalCount} (threshold = ${BULK_THRESHOLD})`);

    if (totalCount >= BULK_THRESHOLD) {
      // ── Bulk API path ────────────────────────────────────────────────
      // Check for stale/duplicate runs
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
      const existingRun = await prisma.bulkSearchRun.findFirst({
        where: { ruleId, status: "RUNNING", startedAt: { gt: sixHoursAgo } },
      });
      if (existingRun) {
        console.log(`[search-runner] Rule ${ruleId}: bulk run ${existingRun.id} already in progress, skipping`);
        return { status: "SKIPPED" as any, recordsFound: 0, recordsRouted: 0, recordsFailed: 0, durationMs: 0 };
      }

      const run = await prisma.bulkSearchRun.create({
        data: { orgId, ruleId, recordsFound: totalCount },
      });

      const bulkSoql = buildSearchSOQL(rule.objectType, searchCriteria, 0, true); // omitLimit=true
      const matchConfig = (rule as any).matchConfig || null;

      // Auto-scale batch size based on record count if user didn't configure one
      const userBatchSize = (rule as any).searchBatchSize as number | null;
      const effectiveBatchSize = userBatchSize || (totalCount >= 10_000 ? 10_000 : 500);
      console.log(`[search-runner] Bulk path — batch size: ${effectiveBatchSize} (user: ${userBatchSize ?? 'auto'})`);

      const result = await runBulkSearch(conn, bulkSoql, ruleId, orgId, rule.objectType, matchConfig, {
        runId: run.id,
        maxRecords: (rule as any).searchMaxRecords || undefined,
        batchSize: effectiveBatchSize,
      });

      // Update rule stats from bulk result
      const durationMs = Date.now() - startTime;
      const status = (result.recordsFailed ?? 0) === 0
        ? "SUCCESS"
        : (result.recordsRouted ?? 0) > 0
          ? "PARTIAL"
          : "FAILED";
      await updateRuleStats(ruleId, result.recordsRouted ?? 0, result.recordsFound ?? totalCount, durationMs, status);

      return { ...result, durationMs };
    }

    // ── REST path (< BULK_THRESHOLD records) ───────────────────────────
    return await runRestPath(conn, rule, ruleId, orgId, searchCriteria, startTime);
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.error(`[search-runner] Error running rule ${ruleId}:`, err);
    await updateRuleStats(ruleId, 0, 0, durationMs, "FAILED");
    return { status: "FAILED", durationMs, error: err.message };
  }
}

/**
 * REST query path — used when record count is below BULK_THRESHOLD.
 * This is the original logic extracted into a helper.
 */
async function runRestPath(
  conn: Awaited<ReturnType<typeof getOrgConnection>>,
  rule: any,
  ruleId: string,
  orgId: string,
  searchCriteria: CachedRule["searchCriteria"],
  startTime: number
): Promise<RunResult> {
  // Build SOQL query
  const soql = buildSearchSOQL(rule.objectType, searchCriteria);
  console.log(`[search-runner] REST path — Querying SFDC: ${soql}`);

  // Query Salesforce (paginated)
  let records: Array<Record<string, unknown> & { Id: string }> = [];
  let queryResult = await conn.query(soql);
  records.push(...(queryResult.records as typeof records));
  while (!queryResult.done && queryResult.nextRecordsUrl) {
    queryResult = await conn.queryMore(queryResult.nextRecordsUrl);
    records.push(...(queryResult.records as typeof records));
  }

  console.log(`[search-runner] Found ${records.length} records for rule ${ruleId}`);

  if (records.length === 0) {
    await updateRuleStats(ruleId, 0, 0, Date.now() - startTime, "SUCCESS");
    return { status: "SUCCESS", recordsFound: 0, recordsRouted: 0, durationMs: Date.now() - startTime };
  }

  // Route each record through the standard pipeline (batched)
  const batchSize = 200;
  let routed = 0;
  let failed = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((record) =>
        routeRecord({
          orgId,
          objectType: rule.objectType as "LEAD" | "CONTACT" | "ACCOUNT",
          eventType: "SEARCH",
          recordId: record.Id,
          fields: record,
          timestamp: new Date().toISOString(),
        })
      )
    );

    for (const r of results) {
      if (r.status === "fulfilled") routed++;
      else failed++;
    }
  }

  // Update rule stats
  const durationMs = Date.now() - startTime;
  const status = failed === 0 ? "SUCCESS" : routed > 0 ? "PARTIAL" : "FAILED";
  await updateRuleStats(ruleId, routed, records.length, durationMs, status);

  return { status, recordsFound: records.length, recordsRouted: routed, recordsFailed: failed, durationMs };
}

async function updateRuleStats(
  ruleId: string,
  recordsRouted: number,
  recordsFound: number,
  durationMs: number,
  status: string
) {
  try {
    await prisma.routingRule.update({
      where: { id: ruleId },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: status,
        lastRunRecords: recordsRouted,
        lastRunDurationMs: durationMs,
        totalRuns: { increment: 1 },
        totalRecordsRouted: { increment: recordsRouted },
      } as any, // `as any` until Prisma client is regenerated with new schema fields
    });
  } catch (err) {
    console.error(`[search-runner] Failed to update rule stats for ${ruleId}:`, err);
  }
}
