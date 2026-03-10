import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { parseFilters } from "../filters";

/**
 * GET /api/analytics/conversions
 *
 * Returns conversion analytics data: KPI totals, speed-to-conversion buckets,
 * breakdowns by rule and assignee.
 */
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const { fromDate, toDate, ruleId, teamId, assigneeId } = parseFilters(req.nextUrl.searchParams);

    // Build WHERE clause for conversion_tracking table
    let where = '"orgId" = $1 AND "createdAt" >= $2 AND "createdAt" <= $3';
    const params: unknown[] = [orgId, fromDate, toDate];
    let idx = 4;
    if (ruleId) { where += ` AND "ruleId" = $${idx++}`; params.push(ruleId); }
    if (teamId) { where += ` AND "teamId" = $${idx++}`; params.push(teamId); }
    if (assigneeId) { where += ` AND "assigneeId" = $${idx++}`; params.push(assigneeId); }

    // Build ct-prefixed WHERE clause for the speed buckets join query
    let ctWhere = 'ct."orgId" = $1 AND ct."createdAt" >= $2 AND ct."createdAt" <= $3';
    let ctIdx = 4;
    if (ruleId) { ctWhere += ` AND ct."ruleId" = $${ctIdx++}`; }
    if (teamId) { ctWhere += ` AND ct."teamId" = $${ctIdx++}`; }
    if (assigneeId) { ctWhere += ` AND ct."assigneeId" = $${ctIdx++}`; }

    // KPI totals
    const kpis = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        COUNT(*)::integer as total,
        COUNT(*) FILTER (WHERE "isConverted" = true)::integer as converted,
        COALESCE(SUM("opportunityAmount") FILTER (WHERE "isConverted" = true), 0)::double precision as pipeline,
        AVG("opportunityAmount") FILTER (WHERE "isConverted" = true)::double precision as avg_deal
      FROM conversion_tracking
      WHERE ${where}
    `, ...params);

    // Speed-to-conversion: join with routing_logs to get routingDurationMs, bucket by speed
    const speedBuckets = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        CASE
          WHEN rl."routingDurationMs" IS NULL THEN 'unknown'
          WHEN rl."routingDurationMs" <= 1000 THEN '0-1s'
          WHEN rl."routingDurationMs" <= 5000 THEN '1-5s'
          WHEN rl."routingDurationMs" <= 15000 THEN '5-15s'
          WHEN rl."routingDurationMs" <= 60000 THEN '15-60s'
          ELSE '1min+'
        END as bucket,
        COUNT(*)::integer as total,
        COUNT(*) FILTER (WHERE ct."isConverted" = true)::integer as converted
      FROM conversion_tracking ct
      JOIN routing_logs rl ON rl.id = ct."routingLogId"
      WHERE ${ctWhere}
      GROUP BY 1
      ORDER BY
        CASE
          WHEN rl."routingDurationMs" IS NULL THEN 6
          WHEN rl."routingDurationMs" <= 1000 THEN 1
          WHEN rl."routingDurationMs" <= 5000 THEN 2
          WHEN rl."routingDurationMs" <= 15000 THEN 3
          WHEN rl."routingDurationMs" <= 60000 THEN 4
          ELSE 5
        END
    `, ...params);

    // Conversion by rule
    const byRule = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        "ruleId", "ruleName",
        COUNT(*)::integer as total,
        COUNT(*) FILTER (WHERE "isConverted" = true)::integer as converted,
        COALESCE(SUM("opportunityAmount") FILTER (WHERE "isConverted" = true), 0)::double precision as pipeline
      FROM conversion_tracking
      WHERE ${where} AND "ruleId" IS NOT NULL
      GROUP BY "ruleId", "ruleName"
      ORDER BY converted DESC
    `, ...params);

    // Conversion by assignee
    const byAssignee = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        "assigneeId", "assigneeName",
        COUNT(*)::integer as total,
        COUNT(*) FILTER (WHERE "isConverted" = true)::integer as converted,
        COALESCE(SUM("opportunityAmount") FILTER (WHERE "isConverted" = true), 0)::double precision as pipeline
      FROM conversion_tracking
      WHERE ${where} AND "assigneeId" IS NOT NULL
      GROUP BY "assigneeId", "assigneeName"
      ORDER BY converted DESC
    `, ...params);

    const k = kpis[0] ?? { total: 0, converted: 0, pipeline: 0, avg_deal: null };

    return NextResponse.json({
      converted: Number(k.converted),
      total: Number(k.total),
      conversionRate: Number(k.total) > 0 ? Math.round(Number(k.converted) / Number(k.total) * 1000) / 10 : 0,
      pipeline: Math.round(Number(k.pipeline)),
      avgDeal: k.avg_deal ? Math.round(Number(k.avg_deal)) : null,
      speedBuckets: speedBuckets.map(b => ({
        bucket: b.bucket,
        total: Number(b.total),
        converted: Number(b.converted),
        conversionRate: Number(b.total) > 0 ? Math.round(Number(b.converted) / Number(b.total) * 1000) / 10 : 0,
      })),
      byRule: byRule.map(r => ({
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        total: Number(r.total),
        converted: Number(r.converted),
        conversionRate: Number(r.total) > 0 ? Math.round(Number(r.converted) / Number(r.total) * 1000) / 10 : 0,
        pipeline: Math.round(Number(r.pipeline)),
      })),
      byAssignee: byAssignee.map(a => ({
        assigneeId: a.assigneeId,
        assigneeName: a.assigneeName || a.assigneeId,
        total: Number(a.total),
        converted: Number(a.converted),
        conversionRate: Number(a.total) > 0 ? Math.round(Number(a.converted) / Number(a.total) * 1000) / 10 : 0,
        pipeline: Math.round(Number(a.pipeline)),
      })),
    });
  } catch (err) {
    console.error("GET /api/analytics/conversions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
