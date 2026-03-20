import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/routing-logs/stats?period=today|week|month|custom&from=&to=
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const p = req.nextUrl.searchParams;
    const period = p.get("period") ?? "month";

    let from: Date;
    let to: Date = new Date();

    if (period === "custom") {
      const f = p.get("from");
      const t = p.get("to");
      if (!f || !t) {
        return NextResponse.json({ error: "from and to required for custom period" }, { status: 400 });
      }
      from = new Date(f);
      to = new Date(t);
    } else {
      const now = new Date();
      if (period === "today") {
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      } else if (period === "week") {
        from = new Date(now);
        from.setDate(now.getDate() - 6);
        from.setHours(0, 0, 0, 0);
      } else {
        // month
        from = new Date(now.getFullYear(), now.getMonth(), 1);
      }
    }

    // Per-rep counts grouped by assigneeName and objectType
    const rows = await prisma.routingLog.groupBy({
      by: ["assigneeName", "objectType"],
      where: {
        orgId,
        status: "SUCCESS",
        assigneeName: { not: null },
        createdAt: { gte: from, lte: to },
      },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    // Pivot by assigneeName → { LEAD, CONTACT, ACCOUNT, USER, total }
    const statsMap = new Map<string, { LEAD: number; CONTACT: number; ACCOUNT: number; USER: number; total: number }>();

    for (const row of rows) {
      const name = row.assigneeName!;
      if (!statsMap.has(name)) {
        statsMap.set(name, { LEAD: 0, CONTACT: 0, ACCOUNT: 0, USER: 0, total: 0 });
      }
      const entry = statsMap.get(name)!;
      const count = row._count.id;
      entry[row.objectType] += count;
      entry.total += count;
    }

    const stats = Array.from(statsMap.entries())
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.total - a.total);

    return NextResponse.json({ stats, from: from.toISOString(), to: to.toISOString(), period });
  } catch (err) {
    console.error("GET /api/routing-logs/stats error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
