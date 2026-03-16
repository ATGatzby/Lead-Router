import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { parseFilters, buildAggregateQuery } from "../filters";
import { getTierLimits, upgradeRequiredResponse } from "@/lib/license";

interface AggRow {
  total: bigint;
  success: bigint;
  failed: bigint;
  unmatched: bigint;
  merged: bigint;
  avg_duration: number | null;
}

interface ConvRow {
  total: bigint;
  converted: bigint;
}

function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * GET /api/analytics/overview
 *
 * Returns KPI card data (Total Routed, Success Rate, Avg Speed-to-Lead,
 * Conversion Rate) with delta vs the prior period of equal length,
 * plus a status breakdown for the donut chart.
 */
export async function GET(req: NextRequest) {
  try {
    const limits = getTierLimits();
    if (!limits.analytics) {
      return upgradeRequiredResponse("Analytics");
    }

    const orgId = await getOrgIdFromHeaders();
    const filters = parseFilters(req.nextUrl.searchParams);

    // --- Current period aggregate -------------------------------------------
    const { where, params } = buildAggregateQuery(orgId, filters);

    // --- Prior period (same duration, immediately preceding) -----------------
    const periodMs = filters.toDate.getTime() - filters.fromDate.getTime();
    const priorFrom = new Date(filters.fromDate.getTime() - periodMs);
    const priorTo = new Date(filters.fromDate.getTime() - 1);
    const priorFilters = { ...filters, fromDate: priorFrom, toDate: priorTo };
    const { where: priorWhere, params: priorParams } = buildAggregateQuery(
      orgId,
      priorFilters,
    );

    const aggSql = (w: string) => `
      SELECT
        COALESCE(SUM("totalCount"),   0)::bigint AS total,
        COALESCE(SUM("successCount"), 0)::bigint AS success,
        COALESCE(SUM("failedCount"),  0)::bigint AS failed,
        COALESCE(SUM("unmatchedCount"), 0)::bigint AS unmatched,
        COALESCE(SUM("mergedCount"),  0)::bigint AS merged,
        AVG("avgDurationMs") AS avg_duration
      FROM routing_daily_aggregates
      WHERE ${w}
    `;

    // --- Conversion tracking ------------------------------------------------
    function convSql(dateFrom: Date, dateTo: Date) {
      let convWhere = '"orgId" = $1 AND "createdAt" >= $2 AND "createdAt" <= $3';
      const convParams: unknown[] = [orgId, dateFrom, dateTo];
      let idx = 4;
      if (filters.ruleId) {
        convWhere += ` AND "ruleId" = $${idx++}`;
        convParams.push(filters.ruleId);
      }
      if (filters.teamId) {
        convWhere += ` AND "teamId" = $${idx++}`;
        convParams.push(filters.teamId);
      }
      if (filters.assigneeId) {
        convWhere += ` AND "assigneeId" = $${idx++}`;
        convParams.push(filters.assigneeId);
      }
      return {
        sql: `
          SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE "isConverted" = true)::bigint AS converted
          FROM conversion_tracking
          WHERE ${convWhere}
        `,
        params: convParams,
      };
    }

    const currConv = convSql(filters.fromDate, filters.toDate);
    const priorConv = convSql(priorFrom, priorTo);

    const [currentRows, priorRows, currConvRows, priorConvRows] =
      await Promise.all([
        prisma.$queryRawUnsafe<AggRow[]>(aggSql(where), ...params),
        prisma.$queryRawUnsafe<AggRow[]>(aggSql(priorWhere), ...priorParams),
        prisma.$queryRawUnsafe<ConvRow[]>(currConv.sql, ...currConv.params),
        prisma.$queryRawUnsafe<ConvRow[]>(priorConv.sql, ...priorConv.params),
      ]);

    const curr: AggRow = currentRows[0] ?? {
      total: BigInt(0),
      success: BigInt(0),
      failed: BigInt(0),
      unmatched: BigInt(0),
      merged: BigInt(0),
      avg_duration: null,
    };
    const prior: AggRow = priorRows[0] ?? {
      total: BigInt(0),
      success: BigInt(0),
      failed: BigInt(0),
      unmatched: BigInt(0),
      merged: BigInt(0),
      avg_duration: null,
    };
    const currC: ConvRow = currConvRows[0] ?? { total: BigInt(0), converted: BigInt(0) };
    const priorC: ConvRow = priorConvRows[0] ?? { total: BigInt(0), converted: BigInt(0) };

    // --- Compute KPIs -------------------------------------------------------
    const totalRouted = Number(curr.total);
    const priorTotal = Number(prior.total);

    const successRate =
      totalRouted > 0 ? (Number(curr.success) / totalRouted) * 100 : 0;
    const priorSuccessRate =
      priorTotal > 0 ? (Number(prior.success) / priorTotal) * 100 : 0;

    const avgSpeed =
      curr.avg_duration != null ? Number(curr.avg_duration) / 1000 : null;
    const priorAvgSpeed =
      prior.avg_duration != null ? Number(prior.avg_duration) / 1000 : null;

    const convTotal = Number(currC.total);
    const convConverted = Number(currC.converted);
    const priorConvTotal = Number(priorC.total);
    const priorConvConverted = Number(priorC.converted);

    const convRate = convTotal > 0 ? (convConverted / convTotal) * 100 : 0;
    const priorConvRate =
      priorConvTotal > 0 ? (priorConvConverted / priorConvTotal) * 100 : 0;

    return NextResponse.json({
      totalRouted,
      totalRoutedDelta: pctDelta(totalRouted, priorTotal),
      successRate: Math.round(successRate * 10) / 10,
      successRateDelta:
        priorTotal > 0
          ? Math.round((successRate - priorSuccessRate) * 10) / 10
          : null,
      avgSpeedSeconds:
        avgSpeed != null ? Math.round(avgSpeed * 10) / 10 : null,
      avgSpeedDelta:
        avgSpeed != null && priorAvgSpeed != null
          ? pctDelta(avgSpeed, priorAvgSpeed)
          : null,
      conversionRate: Math.round(convRate * 10) / 10,
      conversionRateDelta:
        priorConvTotal > 0
          ? Math.round((convRate - priorConvRate) * 10) / 10
          : null,
      statusBreakdown: {
        success: Number(curr.success),
        failed: Number(curr.failed),
        unmatched: Number(curr.unmatched),
        merged: Number(curr.merged),
      },
    });
  } catch (err) {
    console.error("GET /api/analytics/overview error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
