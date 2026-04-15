import type { AgentContext } from "../types";

export interface OverviewFilters {
  fromDate: Date;
  toDate: Date;
  ruleId?: string;
  teamId?: string;
}

export interface OverviewResult {
  totalRouted: number;
  successRate: number;
  avgSpeedSeconds: number | null;
  statusBreakdown: {
    success: number;
    failed: number;
    unmatched: number;
    merged: number;
  };
}

export interface RulePerformance {
  ruleId: string;
  ruleName: string;
  total: number;
  success: number;
  failed: number;
}

export interface TeamPerformance {
  teamId: string;
  teamName: string;
  total: number;
  success: number;
  avgDurationMs: number | null;
}

interface AggRow {
  total: bigint;
  success: bigint;
  failed: bigint;
  unmatched: bigint;
  merged: bigint;
  avg_duration: number | null;
}

export class AnalyticsService {
  static async overview(filters: OverviewFilters, ctx: AgentContext): Promise<OverviewResult> {
    let where = `"orgId" = $1 AND "date" >= $2 AND "date" <= $3`;
    const params: unknown[] = [ctx.orgId, filters.fromDate, filters.toDate];
    let idx = 4;

    if (filters.ruleId) {
      where += ` AND "ruleId" = $${idx++}`;
      params.push(filters.ruleId);
    }
    if (filters.teamId) {
      where += ` AND "teamId" = $${idx++}`;
      params.push(filters.teamId);
    }

    const rows = await ctx.prisma.$queryRawUnsafe<AggRow[]>(
      `SELECT
        COALESCE(SUM("totalCount"), 0)::bigint AS total,
        COALESCE(SUM("successCount"), 0)::bigint AS success,
        COALESCE(SUM("failedCount"), 0)::bigint AS failed,
        COALESCE(SUM("unmatchedCount"), 0)::bigint AS unmatched,
        COALESCE(SUM("mergedCount"), 0)::bigint AS merged,
        AVG("avgDurationMs") AS avg_duration
      FROM routing_daily_aggregates
      WHERE ${where}`,
      ...params,
    );

    const row = rows[0] ?? {
      total: BigInt(0),
      success: BigInt(0),
      failed: BigInt(0),
      unmatched: BigInt(0),
      merged: BigInt(0),
      avg_duration: null,
    };

    const totalRouted = Number(row.total);
    const successRate = totalRouted > 0 ? Math.round((Number(row.success) / totalRouted) * 1000) / 10 : 0;
    const avgSpeedSeconds = row.avg_duration != null ? Math.round((Number(row.avg_duration) / 1000) * 10) / 10 : null;

    return {
      totalRouted,
      successRate,
      avgSpeedSeconds,
      statusBreakdown: {
        success: Number(row.success),
        failed: Number(row.failed),
        unmatched: Number(row.unmatched),
        merged: Number(row.merged),
      },
    };
  }

  static async rules(filters: OverviewFilters, ctx: AgentContext): Promise<RulePerformance[]> {
    let where = `a."orgId" = $1 AND a."date" >= $2 AND a."date" <= $3`;
    const params: unknown[] = [ctx.orgId, filters.fromDate, filters.toDate];
    let idx = 4;

    if (filters.ruleId) {
      where += ` AND a."ruleId" = $${idx++}`;
      params.push(filters.ruleId);
    }

    const rows = await ctx.prisma.$queryRawUnsafe<
      Array<{ ruleId: string; ruleName: string; total: bigint; success: bigint; failed: bigint }>
    >(
      `SELECT
        a."ruleId" AS "ruleId",
        r."name" AS "ruleName",
        COALESCE(SUM(a."totalCount"), 0)::bigint AS total,
        COALESCE(SUM(a."successCount"), 0)::bigint AS success,
        COALESCE(SUM(a."failedCount"), 0)::bigint AS failed
      FROM routing_daily_aggregates a
      LEFT JOIN "RoutingRule" r ON r."id" = a."ruleId"
      WHERE ${where} AND a."ruleId" IS NOT NULL
      GROUP BY a."ruleId", r."name"
      ORDER BY total DESC`,
      ...params,
    );

    return rows.map((r: any) => ({
      ruleId: r.ruleId,
      ruleName: r.ruleName ?? "Unknown",
      total: Number(r.total),
      success: Number(r.success),
      failed: Number(r.failed),
    }));
  }

  static async teams(filters: OverviewFilters, ctx: AgentContext): Promise<TeamPerformance[]> {
    let where = `a."orgId" = $1 AND a."date" >= $2 AND a."date" <= $3`;
    const params: unknown[] = [ctx.orgId, filters.fromDate, filters.toDate];
    let idx = 4;

    if (filters.teamId) {
      where += ` AND a."teamId" = $${idx++}`;
      params.push(filters.teamId);
    }

    const rows = await ctx.prisma.$queryRawUnsafe<
      Array<{ teamId: string; teamName: string; total: bigint; success: bigint; avg_duration: number | null }>
    >(
      `SELECT
        a."teamId" AS "teamId",
        t."name" AS "teamName",
        COALESCE(SUM(a."totalCount"), 0)::bigint AS total,
        COALESCE(SUM(a."successCount"), 0)::bigint AS success,
        AVG(a."avgDurationMs") AS avg_duration
      FROM routing_daily_aggregates a
      LEFT JOIN "RoundRobinTeam" t ON t."id" = a."teamId"
      WHERE ${where} AND a."teamId" IS NOT NULL
      GROUP BY a."teamId", t."name"
      ORDER BY total DESC`,
      ...params,
    );

    return rows.map((r: any) => ({
      teamId: r.teamId,
      teamName: r.teamName ?? "Unknown",
      total: Number(r.total),
      success: Number(r.success),
      avgDurationMs: r.avg_duration != null ? Number(r.avg_duration) : null,
    }));
  }
}
