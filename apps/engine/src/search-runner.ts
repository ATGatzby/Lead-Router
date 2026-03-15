import { prisma } from "@lead-routing/db";
import { getActiveRules, type CachedRule } from "./cache.js";
import { buildSearchSOQL } from "./soql-builder.js";
import { routeRecord } from "./router.js";
import { getOrgConnection } from "./sfdc.js";

export interface RunResult {
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
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

    // 3. Build SOQL query
    const soql = buildSearchSOQL(rule.objectType, searchCriteria);
    console.log(`[search-runner] Querying SFDC: ${soql}`);

    // 4. Query Salesforce (paginated)
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

    // 5. Route each record through the standard pipeline (batched)
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

    // 6. Update rule stats
    const durationMs = Date.now() - startTime;
    const status = failed === 0 ? "SUCCESS" : routed > 0 ? "PARTIAL" : "FAILED";
    await updateRuleStats(ruleId, routed, records.length, durationMs, status);

    return { status, recordsFound: records.length, recordsRouted: routed, recordsFailed: failed, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.error(`[search-runner] Error running rule ${ruleId}:`, err);
    await updateRuleStats(ruleId, 0, 0, durationMs, "FAILED");
    return { status: "FAILED", durationMs, error: err.message };
  }
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
