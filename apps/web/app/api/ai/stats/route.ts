import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();

    // Feedback stats
    const [positive, negative, total] = await Promise.all([
      prisma.aiChatFeedback.count({ where: { orgId, rating: "positive" } }),
      prisma.aiChatFeedback.count({ where: { orgId, rating: "negative" } }),
      prisma.aiChatFeedback.count({ where: { orgId } }),
    ]);

    const feedbackScore = total > 0 ? Math.round((positive / total) * 100) : 0;

    // Action stats from AiAgentLog
    const allLogs = await prisma.aiAgentLog.findMany({
      where: { orgId },
      select: {
        status: true,
        toolName: true,
        createdAt: true,
      },
    });

    const confirmed = allLogs.filter((l) => l.status === "confirmed").length;
    const previewed = allLogs.filter((l) => l.status === "preview").length;
    const failed = allLogs.filter((l) => l.status === "failed").length;
    const cancelled = allLogs.filter((l) => l.status === "cancelled").length;

    // Tool usage breakdown
    const byTool: Record<string, number> = {};
    for (const log of allLogs) {
      if (log.toolName) {
        byTool[log.toolName] = (byTool[log.toolName] ?? 0) + 1;
      }
    }

    // Feedback trend - last 30 days grouped by week
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentFeedback = await prisma.aiChatFeedback.findMany({
      where: {
        orgId,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { rating: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // Group by week
    const weeklyTrend: { week: string; positive: number; negative: number }[] = [];
    const weekMap = new Map<string, { positive: number; negative: number }>();

    for (const fb of recentFeedback) {
      const d = new Date(fb.createdAt);
      // Get Monday of that week
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setDate(diff);
      const weekKey = monday.toISOString().split("T")[0];

      if (!weekMap.has(weekKey)) {
        weekMap.set(weekKey, { positive: 0, negative: 0 });
      }
      const entry = weekMap.get(weekKey)!;
      if (fb.rating === "positive") entry.positive++;
      else if (fb.rating === "negative") entry.negative++;
    }

    for (const [week, counts] of weekMap) {
      weeklyTrend.push({ week, ...counts });
    }

    // Recent negative feedback with details
    const recentNegative = await prisma.aiChatFeedback.findMany({
      where: { orgId, rating: "negative" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        userMessage: true,
        aiResponse: true,
        feedback: true,
        context: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      feedbackStats: {
        positive,
        negative,
        total,
        score: feedbackScore,
      },
      actionStats: {
        total: allLogs.length,
        confirmed,
        previewed,
        failed,
        cancelled,
        byTool,
      },
      weeklyTrend,
      recentNegative,
    });
  } catch (err) {
    console.error("GET /api/ai/stats error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch AI stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
