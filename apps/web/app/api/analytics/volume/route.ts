import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { parseFilters, buildAggregateQuery } from "../filters";
import { getTierLimits, upgradeRequiredResponse } from "@/lib/license";

type GroupBy = "status" | "objectType" | "rule" | "team";
type Granularity = "day" | "week" | "month";

const VALID_GROUP_BY = new Set<GroupBy>(["status", "objectType", "rule", "team"]);
const VALID_GRANULARITY = new Set<Granularity>(["day", "week", "month"]);

/**
 * GET /api/analytics/volume
 *
 * Time-series data for the volume chart.
 * Query params (in addition to shared filters):
 *   - groupBy:      status | objectType | rule | team  (default: status)
 *   - granularity:  day | week | month                  (default: day)
 */
export async function GET(req: NextRequest) {
  try {
    const limits = getTierLimits();
    if (!limits.analytics) {
      return upgradeRequiredResponse("Analytics");
    }

    const orgId = await getOrgIdFromHeaders();
    const filters = parseFilters(req.nextUrl.searchParams);

    const groupByRaw = req.nextUrl.searchParams.get("groupBy") || "status";
    const granRaw = req.nextUrl.searchParams.get("granularity") || "day";
    const groupBy: GroupBy = VALID_GROUP_BY.has(groupByRaw as GroupBy)
      ? (groupByRaw as GroupBy)
      : "status";
    const granularity: Granularity = VALID_GRANULARITY.has(granRaw as Granularity)
      ? (granRaw as Granularity)
      : "day";

    const dateTrunc =
      granularity === "month" ? "month" : granularity === "week" ? "week" : "day";

    // ------------------------------------------------------------------
    // groupBy = "status" — pre-aggregated counts, respects all filters
    // ------------------------------------------------------------------
    if (groupBy === "status") {
      const { where, params } = buildAggregateQuery(orgId, filters);

      const rows = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT
          DATE_TRUNC('${dateTrunc}', date) AS period,
          SUM("successCount")::integer   AS success,
          SUM("failedCount")::integer    AS failed,
          SUM("unmatchedCount")::integer AS unmatched,
          SUM("mergedCount")::integer    AS merged,
          SUM("totalCount")::integer     AS total
        FROM routing_daily_aggregates
        WHERE ${where}
        GROUP BY 1
        ORDER BY 1
        `,
        ...params,
      );

      return NextResponse.json({
        series: rows.map((r) => ({
          date: r.period,
          success: Number(r.success),
          failed: Number(r.failed),
          unmatched: Number(r.unmatched),
          merged: Number(r.merged),
          total: Number(r.total),
        })),
      });
    }

    // ------------------------------------------------------------------
    // groupBy = "objectType" — org-level rows broken out by object_type
    // ------------------------------------------------------------------
    if (groupBy === "objectType") {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT
          DATE_TRUNC('${dateTrunc}', date) AS period,
          "objectType",
          SUM("totalCount")::integer AS total
        FROM routing_daily_aggregates
        WHERE "orgId" = $1 AND date >= $2 AND date <= $3
          AND "ruleId" IS NULL AND "teamId" IS NULL AND "assigneeId" IS NULL
        GROUP BY 1, "objectType"
        ORDER BY 1
        `,
        orgId,
        filters.fromDate,
        filters.toDate,
      );

      return NextResponse.json({
        series: rows.map((r) => ({
          date: r.period,
          group: r.objectType,
          total: Number(r.total),
        })),
      });
    }

    // ------------------------------------------------------------------
    // groupBy = "rule" — per-rule rows (path_label IS NULL level)
    // ------------------------------------------------------------------
    if (groupBy === "rule") {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT
          DATE_TRUNC('${dateTrunc}', a.date) AS period,
          a."ruleId",
          r.name AS rule_name,
          SUM(a."totalCount")::integer AS total
        FROM routing_daily_aggregates a
        LEFT JOIN routing_rules r ON r.id = a."ruleId"
        WHERE a."orgId" = $1 AND a.date >= $2 AND a.date <= $3
          AND a."ruleId" IS NOT NULL
          AND a."pathLabel" IS NULL
          AND a."teamId" IS NULL
          AND a."assigneeId" IS NULL
        GROUP BY 1, a."ruleId", r.name
        ORDER BY 1
        `,
        orgId,
        filters.fromDate,
        filters.toDate,
      );

      return NextResponse.json({
        series: rows.map((r) => ({
          date: r.period,
          group: r.rule_name || r.ruleId,
          total: Number(r.total),
        })),
      });
    }

    // ------------------------------------------------------------------
    // groupBy = "team" — per-team rows (assignee_id IS NULL level)
    // ------------------------------------------------------------------
    if (groupBy === "team") {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT
          DATE_TRUNC('${dateTrunc}', a.date) AS period,
          a."teamId",
          t.name AS team_name,
          SUM(a."totalCount")::integer AS total
        FROM routing_daily_aggregates a
        LEFT JOIN round_robin_teams t ON t.id = a."teamId"
        WHERE a."orgId" = $1 AND a.date >= $2 AND a.date <= $3
          AND a."teamId" IS NOT NULL
          AND a."assigneeId" IS NULL
        GROUP BY 1, a."teamId", t.name
        ORDER BY 1
        `,
        orgId,
        filters.fromDate,
        filters.toDate,
      );

      return NextResponse.json({
        series: rows.map((r) => ({
          date: r.period,
          group: r.team_name || r.teamId,
          total: Number(r.total),
        })),
      });
    }

    // Fallback (should not reach here)
    return NextResponse.json({ series: [] });
  } catch (err) {
    console.error("GET /api/analytics/volume error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
