import { prisma } from "@lead-routing/db";
import { getActiveRules, type CachedRule } from "./cache.js";
import { buildSearchSOQL, buildCountSOQL } from "./soql-builder.js";
import { routeRecord } from "./router.js";
import { getOrgConnection } from "./sfdc.js";
import { runBulkSearch } from "./bulk-search.js";
import { runExportRoute } from "./export-runner.js";
import { getOrgHubSpotClient, toCrmObjectType, evictOrgHubSpotClient } from "./hubspot-connection.js";
import { buildSearchRequest, buildCountRequest } from "./hubspot-search-builder.js";
import { getBulkSearchQueue, type BulkSearchJobData } from "./bulk-search-queue.js";
import { redis as redisClient } from "./redis.js";

const BULK_THRESHOLD = 2000;

export interface RunResult {
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED" | "CANCELLED";
  recordsFound?: number;
  recordsRouted?: number;
  recordsFailed?: number;
  durationMs?: number;
  error?: string;
}

export async function runScheduledRoute(ruleId: string, orgId: string, existingRunId?: string): Promise<RunResult> {
  const startTime = Date.now();

  // 1. Load rule from DB (need fresh data for searchCriteria)
  const rule = await prisma.routingRule.findFirst({
    where: { id: ruleId, orgId, status: "ACTIVE" },
  });
  if (!rule) return { status: "SKIPPED", error: "Rule not found or inactive" };
  if ((rule as any).routeType !== "SCHEDULED") return { status: "SKIPPED", error: "Not a scheduled route" };

  // 2. Determine CRM type
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { crmType: true },
  });
  const crmType = org?.crmType ?? "SALESFORCE";

  if (crmType === "HUBSPOT") {
    return runHubSpotScheduledRoute(rule, ruleId, orgId, startTime, existingRunId);
  }

  return runSfdcScheduledRoute(rule, ruleId, orgId, startTime);
}

// ─── HubSpot Scheduled Route ────────────────────────────────────────────────

async function runHubSpotScheduledRoute(
  rule: any,
  ruleId: string,
  orgId: string,
  startTime: number,
  existingRunId?: string,
): Promise<RunResult> {
  const searchCriteria = rule.searchCriteria as CachedRule["searchCriteria"];

  try {
    // Static imports at top of file — dynamic imports don't work with tsup bundling

    const hsClient = await getOrgHubSpotClient(orgId);
    const crmObjectType = toCrmObjectType(rule.objectType);

    // Count query to estimate record count
    const countRequest = buildCountRequest(rule.objectType, searchCriteria);
    const countResult = await hsClient.searchApi.search(crmObjectType, { ...countRequest, limit: 1 });
    const totalCount = countResult.total;
    console.log(`[search-runner] HubSpot Rule ${ruleId}: COUNT = ${totalCount}`);

    if (totalCount === 0) {
      await updateRuleStats(ruleId, 0, 0, Date.now() - startTime, "SUCCESS");
      return { status: "SUCCESS", recordsFound: 0, recordsRouted: 0, durationMs: Date.now() - startTime };
    }

    const searchRequest = buildSearchRequest(rule.objectType, searchCriteria);

    // Auto-scale: >=10K → Export API (Search API caps at 10K)
    //             <10K  → Search API + bulk pipeline (fast, no async wait)
    if (totalCount < 10_000) {
      console.log(`[search-runner] Rule ${ruleId}: ${totalCount} records — using Search API + bulk pipeline`);
      return runHubSpotSearchPath(hsClient, crmObjectType, searchRequest, rule, ruleId, orgId, startTime);
    }

    console.log(`[search-runner] Rule ${ruleId}: ${totalCount} records — using Export API (exceeds 10K Search API cap)`);

    const run = existingRunId
      ? { id: existingRunId }
      : await prisma.bulkSearchRun.create({
          data: { orgId, ruleId, status: "RUNNING" },
        });

    const filterGroups = searchRequest.filterGroups ?? [];
    const properties = searchRequest.properties ?? [];

    let result;
    try {
      result = await runExportRoute(orgId, ruleId, rule.objectType, filterGroups, properties, {
        runId: run.id,
        estimatedTotal: totalCount,
        searchCriteria,
      });
    } catch (exportErr: any) {
      result = { status: "FAILED" as const, recordsFound: 0, recordsRouted: 0, recordsFailed: 0, durationMs: Date.now() - startTime, error: exportErr.message };
    }

    if (result.status !== "FAILED") {
      await updateRuleStats(ruleId, result.recordsRouted, result.recordsFound, result.durationMs, result.status);
      return {
        status: result.status,
        recordsFound: result.recordsFound,
        recordsRouted: result.recordsRouted,
        recordsFailed: result.recordsFailed,
        durationMs: result.durationMs,
      };
    }

    // Export failed — fall back to Search API (10K cap)
    console.warn(`[search-runner] Export API failed for rule ${ruleId}, falling back to Search API: ${result.error ?? "unknown error"}`);
    evictOrgHubSpotClient(orgId);

    // Search API fallback — use bulk pipeline (BullMQ) instead of per-record routeRecord()
    const records = await hsClient.searchApi.searchAll(crmObjectType, searchRequest);
    console.log(`[search-runner] Fallback: found ${records.length} records for rule ${ruleId}`);

    if (records.length === 0) {
      await updateRuleStats(ruleId, 0, 0, Date.now() - startTime, "SUCCESS");
      return { status: "SUCCESS", recordsFound: 0, recordsRouted: 0, durationMs: Date.now() - startTime };
    }

    // Enqueue to bulk pipeline for parallel processing + batchUpdate CRM writes
    const queue = getBulkSearchQueue();
    const runKey = `bulk-run:${run.id}`;
    const batchSize = 200;

    await redisClient.hset(runKey, { status: "RUNNING", phase: "routing", totalRecords: String(records.length) });
    await redisClient.expire(runKey, 86400);

    let totalEnqueued = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const jobData: BulkSearchJobData = {
        orgId,
        ruleId,
        runId: run.id,
        objectType: rule.objectType as "CONTACT" | "COMPANY" | "DEAL",
        records: batch.map((record) => ({
          recordId: record.id,
          fields: record.properties as Record<string, unknown>,
          matchResult: null,
        })),
        simulate: false,
      };
      await queue.add(`search-batch-${totalEnqueued}`, jobData);
      totalEnqueued += batch.length;
    }

    console.log(`[search-runner] Enqueued ${totalEnqueued} records to bulk pipeline`);

    // Wait for bulk pipeline to complete
    const POLL_INTERVAL = 2000;
    const MAX_WAIT = 30 * 60 * 1000;
    const waitStart = Date.now();

    while (Date.now() - waitStart < MAX_WAIT) {
      const data = await redisClient.hgetall(runKey);
      const routed = parseInt(data.routed || "0");
      const failed = parseInt(data.failed || "0");

      if (routed + failed >= totalEnqueued) {
        const durationMs = Date.now() - startTime;
        const status = failed > 0 && routed === 0 ? "FAILED" : "SUCCESS";
        await updateRuleStats(ruleId, routed, totalEnqueued, durationMs, status);
        await redisClient.del(runKey);
        return { status, recordsFound: totalEnqueued, recordsRouted: routed, recordsFailed: failed, durationMs };
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }

    // Timeout
    const durationMs = Date.now() - startTime;
    await updateRuleStats(ruleId, 0, totalEnqueued, durationMs, "FAILED");
    return { status: "FAILED", recordsFound: totalEnqueued, recordsRouted: 0, recordsFailed: 0, durationMs, error: "Timed out" };
  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.error(`[search-runner] Error running HubSpot rule ${ruleId}:`, err);
    await updateRuleStats(ruleId, 0, 0, durationMs, "FAILED");
    return { status: "FAILED", durationMs, error: err.message };
  }
}

// ─── HubSpot Search API path (<10K records) ─────────────────────────────────

async function runHubSpotSearchPath(
  hsClient: any,
  crmObjectType: any,
  searchRequest: any,
  rule: any,
  ruleId: string,
  orgId: string,
  startTime: number,
): Promise<RunResult> {
  const records = await hsClient.searchApi.searchAll(crmObjectType, searchRequest);
  console.log(`[search-runner] Search API: found ${records.length} records for rule ${ruleId}`);

  if (records.length === 0) {
    await updateRuleStats(ruleId, 0, 0, Date.now() - startTime, "SUCCESS");
    return { status: "SUCCESS", recordsFound: 0, recordsRouted: 0, durationMs: Date.now() - startTime };
  }

  const run = await prisma.bulkSearchRun.create({
    data: { orgId, ruleId, status: "RUNNING" },
  });

  const queue = getBulkSearchQueue();
  const runKey = `bulk-run:${run.id}`;
  const batchSize = 200;

  await redisClient.hset(runKey, { status: "RUNNING", phase: "routing", totalRecords: String(records.length) });
  await redisClient.expire(runKey, 86400);

  let totalEnqueued = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const jobData: BulkSearchJobData = {
      orgId,
      ruleId,
      runId: run.id,
      objectType: rule.objectType as "CONTACT" | "COMPANY" | "DEAL",
      records: batch.map((record: any) => ({
        recordId: record.id,
        fields: record.properties as Record<string, unknown>,
        matchResult: null,
      })),
      simulate: false,
    };
    await queue.add(`search-batch-${totalEnqueued}`, jobData);
    totalEnqueued += batch.length;
  }

  console.log(`[search-runner] Enqueued ${totalEnqueued} records to bulk pipeline`);

  // Wait for bulk pipeline to complete
  const POLL_INTERVAL = 2000;
  const MAX_WAIT = 30 * 60 * 1000;
  const waitStart = Date.now();

  while (Date.now() - waitStart < MAX_WAIT) {
    const data = await redisClient.hgetall(runKey);
    const routed = parseInt(data.routed || "0");
    const failed = parseInt(data.failed || "0");

    if (routed + failed >= totalEnqueued) {
      const durationMs = Date.now() - startTime;
      const status = failed > 0 && routed === 0 ? "FAILED" : "SUCCESS";
      await updateRuleStats(ruleId, routed, totalEnqueued, durationMs, status);
      await redisClient.del(runKey);
      return { status, recordsFound: totalEnqueued, recordsRouted: routed, recordsFailed: failed, durationMs };
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout
  const durationMs = Date.now() - startTime;
  await updateRuleStats(ruleId, 0, totalEnqueued, durationMs, "FAILED");
  return { status: "FAILED", recordsFound: totalEnqueued, recordsRouted: 0, recordsFailed: 0, durationMs, error: "Timed out" };
}

// ─── Salesforce Scheduled Route (original logic) ────────────────────────────

async function runSfdcScheduledRoute(
  rule: any,
  ruleId: string,
  orgId: string,
  startTime: number,
): Promise<RunResult> {
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

      const bulkSoql = buildSearchSOQL(rule.objectType, searchCriteria, 0, true);
      const matchConfig = (rule as any).matchConfig || null;

      const userBatchSize = (rule as any).searchBatchSize as number | null;
      const effectiveBatchSize = userBatchSize || (totalCount >= 10_000 ? 10_000 : 500);
      console.log(`[search-runner] Bulk path — batch size: ${effectiveBatchSize} (user: ${userBatchSize ?? 'auto'})`);

      const result = await runBulkSearch(conn, bulkSoql, ruleId, orgId, rule.objectType, matchConfig, {
        runId: run.id,
        maxRecords: (rule as any).searchMaxRecords || undefined,
        batchSize: effectiveBatchSize,
      });

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
 */
async function runRestPath(
  conn: Awaited<ReturnType<typeof getOrgConnection>>,
  rule: any,
  ruleId: string,
  orgId: string,
  searchCriteria: CachedRule["searchCriteria"],
  startTime: number
): Promise<RunResult> {
  const soql = buildSearchSOQL(rule.objectType, searchCriteria);
  console.log(`[search-runner] REST path — Querying SFDC: ${soql}`);

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
      } as any,
    });
  } catch (err) {
    console.error(`[search-runner] Failed to update rule stats for ${ruleId}:`, err);
  }
}
