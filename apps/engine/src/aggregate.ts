import { prisma } from "@lead-routing/db";
import { randomUUID } from "node:crypto";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface AggregateInput {
  orgId: string;
  date: Date;
  ruleId: string | null;
  pathLabel: string | null;
  branchId: string | null;
  teamId: string | null;
  assigneeId: string | null;
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  status: "SUCCESS" | "FAILED" | "UNMATCHED" | "MERGED";
  durationMs: number | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function statusIncrements(status: string) {
  return {
    success: status === "SUCCESS" ? 1 : 0,
    failed: status === "FAILED" ? 1 : 0,
    unmatched: status === "UNMATCHED" ? 1 : 0,
    merged: status === "MERGED" ? 1 : 0,
  };
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

/* ------------------------------------------------------------------ */
/*  Single-dimension upsert (UPDATE-then-INSERT)                      */
/*                                                                    */
/*  Uses `IS NOT DISTINCT FROM` so that NULL dimension columns match  */
/*  correctly — PostgreSQL's unique indexes treat NULL != NULL, but   */
/*  IS NOT DISTINCT FROM treats NULL == NULL.                         */
/* ------------------------------------------------------------------ */

async function upsertAggregate(
  orgId: string,
  date: Date,
  ruleId: string | null,
  pathLabel: string | null,
  branchId: string | null,
  teamId: string | null,
  assigneeId: string | null,
  objectType: string,
  status: string,
  durationMs: number | null,
): Promise<void> {
  const inc = statusIncrements(status);
  const dayDate = startOfDay(date);

  // Try UPDATE first
  const updated: number = await prisma.$executeRawUnsafe(
    `UPDATE routing_daily_aggregates SET
      "successCount"  = "successCount"  + $1,
      "failedCount"   = "failedCount"   + $2,
      "unmatchedCount" = "unmatchedCount" + $3,
      "mergedCount"   = "mergedCount"   + $4,
      "totalCount"    = "totalCount"    + 1,
      "avgDurationMs" = CASE WHEN $5::integer IS NOT NULL THEN
        (COALESCE("avgDurationMs", 0) * "totalCount" + $5::integer) / ("totalCount" + 1)
        ELSE "avgDurationMs" END,
      "minDurationMs" = CASE WHEN $5::integer IS NOT NULL THEN
        LEAST(COALESCE("minDurationMs", $5::integer), $5::integer)
        ELSE "minDurationMs" END,
      "maxDurationMs" = CASE WHEN $5::integer IS NOT NULL THEN
        GREATEST(COALESCE("maxDurationMs", $5::integer), $5::integer)
        ELSE "maxDurationMs" END,
      "updatedAt" = NOW()
    WHERE "orgId"      = $6
      AND date         = $7
      AND "ruleId"     IS NOT DISTINCT FROM $8
      AND "pathLabel"  IS NOT DISTINCT FROM $9
      AND "branchId"   IS NOT DISTINCT FROM $10
      AND "teamId"     IS NOT DISTINCT FROM $11
      AND "assigneeId" IS NOT DISTINCT FROM $12
      AND "objectType" IS NOT DISTINCT FROM $13::"SfdcObjectType"`,
    inc.success,
    inc.failed,
    inc.unmatched,
    inc.merged,
    durationMs,
    orgId,
    dayDate,
    ruleId,
    pathLabel,
    branchId,
    teamId,
    assigneeId,
    objectType,
  );

  if (updated === 0) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO routing_daily_aggregates (
        id, "orgId", date, "ruleId", "pathLabel", "branchId",
        "teamId", "assigneeId", "objectType",
        "successCount", "failedCount", "unmatchedCount", "mergedCount", "totalCount",
        "avgDurationMs", "minDurationMs", "maxDurationMs",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9::"SfdcObjectType",
        $10, $11, $12, $13, 1,
        $14::double precision, $14::integer, $14::integer,
        NOW(), NOW()
      )`,
      randomUUID(),
      orgId,
      dayDate,
      ruleId,
      pathLabel,
      branchId,
      teamId,
      assigneeId,
      objectType,
      inc.success,
      inc.failed,
      inc.unmatched,
      inc.merged,
      durationMs,
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Public: updateAggregates                                          */
/*                                                                    */
/*  Fires multiple dimension-level upserts in parallel.               */
/*  Uses Promise.allSettled so a single failure never blocks routing.  */
/* ------------------------------------------------------------------ */

export async function updateAggregates(input: AggregateInput): Promise<void> {
  const {
    orgId,
    date,
    ruleId,
    pathLabel,
    branchId,
    teamId,
    assigneeId,
    objectType,
    status,
    durationMs,
  } = input;

  const upserts: Promise<void>[] = [];

  // 1. Org-level aggregate (all dimension columns null)
  upserts.push(
    upsertAggregate(orgId, date, null, null, null, null, null, objectType, status, durationMs),
  );

  // 2. Per-rule aggregate
  if (ruleId) {
    upserts.push(
      upsertAggregate(orgId, date, ruleId, null, null, null, null, objectType, status, durationMs),
    );
  }

  // 3. Per-path aggregate (includes branchId for drill-down)
  if (ruleId && pathLabel) {
    upserts.push(
      upsertAggregate(
        orgId, date, ruleId, pathLabel, branchId, null, null, objectType, status, durationMs,
      ),
    );
  }

  // 4. Per-team aggregate
  if (teamId) {
    upserts.push(
      upsertAggregate(orgId, date, null, null, null, teamId, null, objectType, status, durationMs),
    );
  }

  // 5. Per-assignee aggregate (scoped under team)
  if (assigneeId) {
    upserts.push(
      upsertAggregate(
        orgId, date, null, null, null, teamId, assigneeId, objectType, status, durationMs,
      ),
    );
  }

  // Fire-and-forget — never block routing
  await Promise.allSettled(upserts).catch(() => {});
}

/* ------------------------------------------------------------------ */
/*  Public: createConversionTracking                                  */
/*                                                                    */
/*  Creates a conversion_tracking row when a Lead is successfully     */
/*  routed. The row sits unconverted until a cron job or webhook      */
/*  detects the Lead was converted in Salesforce.                     */
/* ------------------------------------------------------------------ */

export async function createConversionTracking(input: {
  orgId: string;
  routingLogId: string;
  sfdcLeadId: string;
  ruleId: string | null;
  ruleName: string | null;
  pathLabel: string | null;
  teamId: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
}): Promise<void> {
  try {
    await prisma.conversionTracking.create({
      data: {
        orgId: input.orgId,
        routingLogId: input.routingLogId,
        sfdcLeadId: input.sfdcLeadId,
        ruleId: input.ruleId,
        ruleName: input.ruleName,
        pathLabel: input.pathLabel,
        teamId: input.teamId,
        assigneeId: input.assigneeId,
        assigneeName: input.assigneeName,
      },
    });
  } catch (err) {
    // Never block routing — log and swallow
    console.error("[aggregate] Failed to create conversion tracking:", err);
  }
}
