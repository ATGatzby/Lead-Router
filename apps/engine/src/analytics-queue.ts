import { Queue, Worker, type Job } from "bullmq";
import { redis } from "./redis.js";
import { prisma } from "@lead-routing/db";
import { getOrgConnection } from "./sfdc.js";

// ─── Queue name ──────────────────────────────────────────────────────────────

const RECONCILIATION_QUEUE = "analytics-reconciliation";

// ─── Worker logic ────────────────────────────────────────────────────────────

async function reconcileAggregates(job: Job): Promise<void> {
  const targetDate = job.data?.date
    ? new Date(job.data.date)
    : new Date(Date.now() - 86400000); // yesterday

  targetDate.setUTCHours(0, 0, 0, 0);
  const nextDay = new Date(targetDate);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  console.log(
    `[analytics] Reconciling aggregates for ${targetDate.toISOString().split("T")[0]}`
  );

  // Get all orgs that had routing activity on the target date
  const orgs = await prisma.$queryRawUnsafe<{ orgId: string }[]>(
    `SELECT DISTINCT "orgId" FROM routing_logs WHERE "createdAt" >= $1 AND "createdAt" < $2`,
    targetDate,
    nextDay
  );

  for (const { orgId } of orgs) {
    // Delete existing aggregates for this date/org (full replace)
    await prisma.$executeRawUnsafe(
      `DELETE FROM routing_daily_aggregates WHERE "orgId" = $1 AND date = $2`,
      orgId,
      targetDate
    );

    // Recompute from raw logs using separate queries per dimension level.
    // GROUPING SETS can't distinguish "NULL from grouping" vs "NULL in data",
    // causing duplicate rows when e.g. teamId is NULL in routing_logs.
    const baseCols = `
        id, "orgId", date, "ruleId", "pathLabel", "branchId", "teamId", "assigneeId", "objectType",
        "successCount", "failedCount", "unmatchedCount", "mergedCount", "totalCount",
        "avgDurationMs", "minDurationMs", "maxDurationMs", "p50DurationMs", "p95DurationMs",
        "createdAt", "updatedAt"`;
    const baseAggs = `
        COUNT(*) FILTER (WHERE status = 'SUCCESS'),
        COUNT(*) FILTER (WHERE status = 'FAILED'),
        COUNT(*) FILTER (WHERE status = 'UNMATCHED'),
        COUNT(*) FILTER (WHERE status = 'MERGED'),
        COUNT(*),
        AVG("routingDurationMs")::double precision,
        MIN("routingDurationMs"),
        MAX("routingDurationMs"),
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "routingDurationMs") FILTER (WHERE "routingDurationMs" IS NOT NULL)::integer,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "routingDurationMs") FILTER (WHERE "routingDurationMs" IS NOT NULL)::integer,
        NOW(), NOW()`;
    const baseWhere = `"orgId" = $1 AND "createdAt" >= $2 AND "createdAt" < $3`;

    // Level 1: Org + objectType (org-level totals)
    await prisma.$executeRawUnsafe(`
      INSERT INTO routing_daily_aggregates (${baseCols})
      SELECT gen_random_uuid()::text, $1, $2::date, NULL, NULL, NULL, NULL, NULL, "objectType",
        ${baseAggs}
      FROM routing_logs WHERE ${baseWhere}
      GROUP BY "objectType"
    `, orgId, targetDate, nextDay);

    // Level 2: Per-rule (pathLabel/branchId NULL)
    await prisma.$executeRawUnsafe(`
      INSERT INTO routing_daily_aggregates (${baseCols})
      SELECT gen_random_uuid()::text, $1, $2::date, "ruleId", NULL, NULL, NULL, NULL, "objectType",
        ${baseAggs}
      FROM routing_logs WHERE ${baseWhere} AND "ruleId" IS NOT NULL
      GROUP BY "objectType", "ruleId"
    `, orgId, targetDate, nextDay);

    // Level 3: Per-rule + path + branch
    await prisma.$executeRawUnsafe(`
      INSERT INTO routing_daily_aggregates (${baseCols})
      SELECT gen_random_uuid()::text, $1, $2::date, "ruleId", "pathLabel", "branchId", NULL, NULL, "objectType",
        ${baseAggs}
      FROM routing_logs WHERE ${baseWhere} AND "ruleId" IS NOT NULL AND "pathLabel" IS NOT NULL
      GROUP BY "objectType", "ruleId", "pathLabel", "branchId"
    `, orgId, targetDate, nextDay);

    // Level 4: Per-team (assigneeId NULL)
    await prisma.$executeRawUnsafe(`
      INSERT INTO routing_daily_aggregates (${baseCols})
      SELECT gen_random_uuid()::text, $1, $2::date, NULL, NULL, NULL, "teamId", NULL, "objectType",
        ${baseAggs}
      FROM routing_logs WHERE ${baseWhere} AND "teamId" IS NOT NULL
      GROUP BY "objectType", "teamId"
    `, orgId, targetDate, nextDay);

    // Level 5: Per-team + assignee
    await prisma.$executeRawUnsafe(`
      INSERT INTO routing_daily_aggregates (${baseCols})
      SELECT gen_random_uuid()::text, $1, $2::date, NULL, NULL, NULL, "teamId", "assigneeId", "objectType",
        ${baseAggs}
      FROM routing_logs WHERE ${baseWhere} AND "teamId" IS NOT NULL AND "assigneeId" IS NOT NULL
      GROUP BY "objectType", "teamId", "assigneeId"
    `, orgId, targetDate, nextDay);
  }

  console.log(
    `[analytics] Reconciliation complete for ${targetDate.toISOString().split("T")[0]}: processed ${orgs.length} orgs`
  );
}

// ─── Conversion check logic ─────────────────────────────────────────────────

interface ConversionTrackingRow {
  id: string;
  crmRecordId: string;
}

interface SfdcLeadResult {
  Id: string;
  IsConverted: boolean;
  ConvertedDate: string | null;
  ConvertedOpportunityId: string | null;
}

interface SfdcOpportunityResult {
  Id: string;
  Amount: number | null;
  StageName: string | null;
}

/** Split an array into chunks of the given size. */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

async function checkConversions(_job: Job): Promise<void> {
  // 1. Get all distinct orgs with unconverted leads in the last 90 days
  const orgs = await prisma.$queryRawUnsafe<{ orgId: string }[]>(
    `SELECT DISTINCT "orgId" FROM conversion_tracking WHERE "isConverted" = false AND "createdAt" > NOW() - INTERVAL '90 days'`
  );

  console.log(`[analytics] Conversion check: ${orgs.length} orgs to process`);

  for (const { orgId } of orgs) {
    try {
      // 2a. Get SFDC connection for this org
      const conn = await getOrgConnection(orgId);

      // 2b. Get unconverted leads for this org
      const rows = await prisma.$queryRawUnsafe<ConversionTrackingRow[]>(
        `SELECT id, "crmRecordId" FROM conversion_tracking WHERE "orgId" = $1 AND "isConverted" = false AND "createdAt" > NOW() - INTERVAL '90 days'`,
        orgId
      );

      if (rows.length === 0) continue;

      const leadIdMap = new Map<string, string>(); // crmRecordId → conversion_tracking.id
      for (const row of rows) {
        leadIdMap.set(row.crmRecordId, row.id);
      }

      let convertedCount = 0;

      // 2c. Batch into chunks of 200 (SOQL IN clause limit)
      const batches = chunk(Array.from(leadIdMap.keys()), 200);

      for (const batch of batches) {
        // 2d. Query SFDC for converted leads in this batch
        const inClause = batch.filter((id) => /^[a-zA-Z0-9]+$/.test(id)).map((id) => `'${id}'`).join(",");
        const leadResult = await conn.query<SfdcLeadResult>(
          `SELECT Id, IsConverted, ConvertedDate, ConvertedOpportunityId FROM Lead WHERE Id IN (${inClause}) AND IsConverted = true`
        );

        for (const lead of leadResult.records) {
          const trackingId = leadIdMap.get(lead.Id);
          if (!trackingId) continue;

          let oppAmount: number | null = null;
          let oppStageName: string | null = null;

          // 2e. Fetch opportunity details if one exists
          if (lead.ConvertedOpportunityId) {
            try {
              const oppResult = await conn.query<SfdcOpportunityResult>(
                `SELECT Id, Amount, StageName FROM Opportunity WHERE Id = '${lead.ConvertedOpportunityId}'`
              );
              if (oppResult.records.length > 0) {
                oppAmount = oppResult.records[0].Amount;
                oppStageName = oppResult.records[0].StageName;
              }
            } catch {
              // Opportunity query failed — continue without opp data
            }
          }

          // 2f. Update conversion_tracking row
          await prisma.$executeRawUnsafe(
            `UPDATE conversion_tracking SET "isConverted" = true, "convertedAt" = $1, "opportunityId" = $2, "opportunityAmount" = $3, "opportunityStageName" = $4, "lastCheckedAt" = NOW() WHERE id = $5`,
            lead.ConvertedDate ? new Date(lead.ConvertedDate) : new Date(),
            lead.ConvertedOpportunityId,
            oppAmount,
            oppStageName,
            trackingId
          );

          convertedCount++;
        }
      }

      // 2g. Update lastCheckedAt for all non-converted rows in this org
      await prisma.$executeRawUnsafe(
        `UPDATE conversion_tracking SET "lastCheckedAt" = NOW() WHERE "orgId" = $1 AND "isConverted" = false AND "createdAt" > NOW() - INTERVAL '90 days'`,
        orgId
      );

      console.log(
        `[analytics] Conversion check: org ${orgId} — ${convertedCount} new conversions found`
      );
    } catch (err) {
      console.error(
        `[analytics] Conversion check: org ${orgId} failed, skipping:`,
        err
      );
      continue;
    }
  }

  console.log("[analytics] Conversion check complete");
}

// ─── Queue ───────────────────────────────────────────────────────────────────

export const analyticsQueue = new Queue(RECONCILIATION_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 30 },
    removeOnFail: { count: 100 },
  },
});

// ─── Worker ──────────────────────────────────────────────────────────────────

export const analyticsWorker = new Worker(
  RECONCILIATION_QUEUE,
  async (job) => {
    if (job.name === "nightly-reconciliation" || job.name === "manual-reconciliation") {
      return reconcileAggregates(job);
    }
    if (job.name === "conversion-check" || job.name === "manual-conversion-check") {
      return checkConversions(job);
    }
    console.warn(`[analytics] Unknown job name: ${job.name}`);
  },
  { connection: redis }
);

analyticsWorker.on("completed", (job: Job) => {
  console.log(`[analytics] Job ${job.name} (${job.id}) completed`);
});

analyticsWorker.on("failed", (job: Job | undefined, err: Error) => {
  console.error(`[analytics] Job ${job?.name} (${job?.id}) failed:`, err);
});

analyticsWorker.on("error", (err: Error) => {
  console.error("[analytics] Worker error:", err);
});

// ─── Scheduling ──────────────────────────────────────────────────────────────

async function scheduleReconciliation(): Promise<void> {
  // Remove existing repeatable jobs first (to handle schedule changes)
  const existing = await analyticsQueue.getRepeatableJobs();
  for (const job of existing) {
    await analyticsQueue.removeRepeatableByKey(job.key);
  }

  await analyticsQueue.add(
    "nightly-reconciliation",
    {},
    { repeat: { pattern: "0 2 * * *" } }
  );
  console.log("[analytics] Scheduled nightly reconciliation at 02:00 UTC");

  await analyticsQueue.add(
    "conversion-check",
    {},
    { repeat: { pattern: "0 */4 * * *" } }
  );
  console.log("[analytics] Scheduled conversion check every 4 hours");
}

// Export for backfill / manual trigger usage
export async function enqueueReconciliation(date?: Date): Promise<void> {
  await analyticsQueue.add("manual-reconciliation", {
    date: date?.toISOString(),
  });
}

// Export for manual conversion check trigger
export async function enqueueConversionCheck(): Promise<void> {
  await analyticsQueue.add("manual-conversion-check", {});
}

// Auto-schedule on import
scheduleReconciliation().catch((err) => {
  console.error("[analytics] Failed to schedule reconciliation:", err);
});
