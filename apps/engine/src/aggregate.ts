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

  // Atomic upsert using the functional unique index (COALESCE handles NULLs).
  // ON CONFLICT eliminates the race condition where concurrent requests
  // could both INSERT duplicate rows with the UPDATE-then-INSERT pattern.
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
    )
    ON CONFLICT (
      "orgId", date,
      COALESCE("ruleId", ''),
      COALESCE("pathLabel", ''),
      COALESCE("branchId", ''),
      COALESCE("teamId", ''),
      COALESCE("assigneeId", ''),
      COALESCE("objectType"::text, '')
    ) DO UPDATE SET
      "successCount"  = routing_daily_aggregates."successCount"  + $10,
      "failedCount"   = routing_daily_aggregates."failedCount"   + $11,
      "unmatchedCount" = routing_daily_aggregates."unmatchedCount" + $12,
      "mergedCount"   = routing_daily_aggregates."mergedCount"   + $13,
      "totalCount"    = routing_daily_aggregates."totalCount"    + 1,
      "avgDurationMs" = CASE WHEN $14::integer IS NOT NULL THEN
        (COALESCE(routing_daily_aggregates."avgDurationMs", 0) * routing_daily_aggregates."totalCount" + $14::integer)
        / (routing_daily_aggregates."totalCount" + 1)
        ELSE routing_daily_aggregates."avgDurationMs" END,
      "minDurationMs" = CASE WHEN $14::integer IS NOT NULL THEN
        LEAST(COALESCE(routing_daily_aggregates."minDurationMs", $14::integer), $14::integer)
        ELSE routing_daily_aggregates."minDurationMs" END,
      "maxDurationMs" = CASE WHEN $14::integer IS NOT NULL THEN
        GREATEST(COALESCE(routing_daily_aggregates."maxDurationMs", $14::integer), $14::integer)
        ELSE routing_daily_aggregates."maxDurationMs" END,
      "updatedAt" = NOW()`,
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
