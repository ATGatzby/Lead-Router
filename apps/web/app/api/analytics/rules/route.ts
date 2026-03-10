import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { parseFilters } from "../filters";

/**
 * GET /api/analytics/rules
 *
 * Per-rule effectiveness table with success/fail/unmatched rates,
 * latency percentiles, and expandable path-label breakdown.
 */
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const { fromDate, toDate, objectType } = parseFilters(
      req.nextUrl.searchParams,
    );

    const params: unknown[] = [orgId, fromDate, toDate];
    let objectFilter = "";
    let idx = 4;
    if (objectType) {
      objectFilter = ` AND a."objectType" = $${idx++}::"SfdcObjectType"`;
      params.push(objectType);
    }

    // Per-rule aggregate (pathLabel IS NULL = rule-level row)
    const rulesPromise = prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        a."ruleId",
        r.name                              AS rule_name,
        SUM(a."totalCount")::integer        AS total,
        SUM(a."successCount")::integer      AS success,
        SUM(a."failedCount")::integer       AS failed,
        SUM(a."unmatchedCount")::integer    AS unmatched,
        AVG(a."avgDurationMs")              AS avg_duration,
        AVG(a."p50DurationMs")::integer     AS p50_duration,
        AVG(a."p95DurationMs")::integer     AS p95_duration
      FROM routing_daily_aggregates a
      LEFT JOIN routing_rules r ON r.id = a."ruleId"
      WHERE a."orgId" = $1 AND a.date >= $2 AND a.date <= $3
        AND a."ruleId" IS NOT NULL
        AND a."pathLabel" IS NULL
        AND a."teamId" IS NULL
        AND a."assigneeId" IS NULL
        ${objectFilter}
      GROUP BY a."ruleId", r.name
      ORDER BY total DESC
      `,
      ...params,
    );

    // Per-path breakdown (pathLabel IS NOT NULL)
    const pathsPromise = prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        a."ruleId",
        a."pathLabel",
        SUM(a."totalCount")::integer   AS total,
        SUM(a."successCount")::integer AS success
      FROM routing_daily_aggregates a
      WHERE a."orgId" = $1 AND a.date >= $2 AND a.date <= $3
        AND a."ruleId" IS NOT NULL
        AND a."pathLabel" IS NOT NULL
        AND a."teamId" IS NULL
        AND a."assigneeId" IS NULL
        ${objectFilter}
      GROUP BY a."ruleId", a."pathLabel"
      ORDER BY total DESC
      `,
      ...params,
    );

    const [rules, paths] = await Promise.all([rulesPromise, pathsPromise]);

    // Group paths by ruleId
    const pathsByRule: Record<string, any[]> = {};
    for (const p of paths) {
      const ruleId = p.ruleId as string;
      if (!pathsByRule[ruleId]) pathsByRule[ruleId] = [];
      pathsByRule[ruleId].push({
        pathLabel: p.pathLabel,
        total: Number(p.total),
        success: Number(p.success),
      });
    }

    return NextResponse.json({
      rules: rules.map((r) => {
        const total = Number(r.total);
        return {
          ruleId: r.ruleId,
          ruleName: r.rule_name,
          total,
          success: Number(r.success),
          failed: Number(r.failed),
          unmatched: Number(r.unmatched),
          successRate:
            total > 0
              ? Math.round((Number(r.success) / total) * 1000) / 10
              : 0,
          unmatchedRate:
            total > 0
              ? Math.round((Number(r.unmatched) / total) * 1000) / 10
              : 0,
          avgDurationMs:
            r.avg_duration != null ? Math.round(Number(r.avg_duration)) : null,
          p50DurationMs:
            r.p50_duration != null ? Number(r.p50_duration) : null,
          p95DurationMs:
            r.p95_duration != null ? Number(r.p95_duration) : null,
          paths: pathsByRule[r.ruleId as string] || [],
        };
      }),
    });
  } catch (err) {
    console.error("GET /api/analytics/rules error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
