import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";

/**
 * GET /api/analytics/agent-api?period=7d
 *
 * Returns agent API tool call stats: usage per tool, error rates,
 * latency, top callers, and warning frequency.
 */
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();

    const period = req.nextUrl.searchParams.get("period") || "7d";
    const days = period === "24h" ? 1 : period === "30d" ? 30 : 7;
    const since = new Date(Date.now() - days * 86_400_000);

    // Total calls in period
    const totalCalls = await prisma.toolCallLog.count({
      where: { orgId, createdAt: { gte: since } },
    });

    // Calls per tool with error rate and avg latency
    const toolStats = await prisma.$queryRawUnsafe<
      Array<{
        tool: string;
        category: string;
        total: bigint;
        errors: bigint;
        rate_limited: bigint;
        avg_duration: number | null;
        max_duration: number | null;
        avg_response_size: number | null;
      }>
    >(
      `SELECT
        tool,
        category,
        COUNT(*)::bigint AS total,
        COUNT(*) FILTER (WHERE status = 'error')::bigint AS errors,
        COUNT(*) FILTER (WHERE status = 'rate_limited')::bigint AS rate_limited,
        AVG("durationMs") AS avg_duration,
        MAX("durationMs") AS max_duration,
        AVG("responseSize") AS avg_response_size
      FROM tool_call_logs
      WHERE "orgId" = $1 AND "createdAt" >= $2
      GROUP BY tool, category
      ORDER BY total DESC`,
      orgId,
      since,
    );

    // Top 5 callers by tokenId
    const topCallers = await prisma.$queryRawUnsafe<
      Array<{ token_id: string; total: bigint; last_used: Date }>
    >(
      `SELECT
        "tokenId" AS token_id,
        COUNT(*)::bigint AS total,
        MAX("createdAt") AS last_used
      FROM tool_call_logs
      WHERE "orgId" = $1 AND "createdAt" >= $2
      GROUP BY "tokenId"
      ORDER BY total DESC
      LIMIT 5`,
      orgId,
      since,
    );

    // Warning frequency
    const warningCount = await prisma.toolCallLog.count({
      where: {
        orgId,
        createdAt: { gte: since },
        NOT: { warnings: { isEmpty: true } },
      },
    });

    return NextResponse.json({
      period,
      since: since.toISOString(),
      totalCalls,
      toolStats: toolStats.map((row) => ({
        tool: row.tool,
        category: row.category,
        total: Number(row.total),
        errors: Number(row.errors),
        rateLimited: Number(row.rate_limited),
        errorRate:
          Number(row.total) > 0
            ? Math.round((Number(row.errors) / Number(row.total)) * 1000) / 10
            : 0,
        avgLatencyMs:
          row.avg_duration != null ? Math.round(row.avg_duration) : null,
        maxLatencyMs:
          row.max_duration != null ? Math.round(Number(row.max_duration)) : null,
        avgResponseSize:
          row.avg_response_size != null
            ? Math.round(Number(row.avg_response_size))
            : null,
      })),
      topCallers: topCallers.map((row) => ({
        tokenId: row.token_id,
        total: Number(row.total),
        lastUsed: row.last_used,
      })),
      warningCount,
    });
  } catch (err) {
    console.error("GET /api/analytics/agent-api error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
