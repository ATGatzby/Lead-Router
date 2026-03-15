import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/health/recursive — recursive routing event counts and recent events
export async function GET() {
  const orgId = await getOrgIdFromHeaders();

  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Count COOLDOWN_SKIPPED and STAMP_SKIPPED for each window
  const [cooldown1h, cooldown24h, cooldown7d, stamp1h, stamp24h, stamp7d] =
    await Promise.all([
      prisma.routingLog.count({
        where: { orgId, status: "COOLDOWN_SKIPPED" as any, createdAt: { gte: oneHourAgo } },
      }),
      prisma.routingLog.count({
        where: { orgId, status: "COOLDOWN_SKIPPED" as any, createdAt: { gte: oneDayAgo } },
      }),
      prisma.routingLog.count({
        where: { orgId, status: "COOLDOWN_SKIPPED" as any, createdAt: { gte: sevenDaysAgo } },
      }),
      prisma.routingLog.count({
        where: { orgId, status: "STAMP_SKIPPED" as any, createdAt: { gte: oneHourAgo } },
      }),
      prisma.routingLog.count({
        where: { orgId, status: "STAMP_SKIPPED" as any, createdAt: { gte: oneDayAgo } },
      }),
      prisma.routingLog.count({
        where: { orgId, status: "STAMP_SKIPPED" as any, createdAt: { gte: sevenDaysAgo } },
      }),
    ]);

  // Recursive bounces: records routed (SUCCESS) 2+ times within 60 seconds
  // Uses raw SQL to find records where max(createdAt) - min(createdAt) < 60s and count >= 2
  const bounceCounts = await prisma.$queryRaw<
    { win: string; cnt: bigint }[]
  >`
    SELECT w.win, COUNT(*)::bigint AS cnt
    FROM (
      SELECT "sfdcRecordId",
             MIN("createdAt") AS "firstSeen",
             MAX("createdAt") AS "lastSeen",
             COUNT(*) AS c
      FROM "routing_logs"
      WHERE "orgId" = ${orgId}
        AND "status" = 'SUCCESS'
        AND "createdAt" >= ${sevenDaysAgo}
      GROUP BY "sfdcRecordId"
      HAVING COUNT(*) >= 2
         AND MAX("createdAt") - MIN("createdAt") < INTERVAL '60 seconds'
    ) dupes
    CROSS JOIN (VALUES ('1h'), ('24h'), ('7d')) AS w(win)
    WHERE (w.win = '1h'  AND dupes."firstSeen" >= ${oneHourAgo})
       OR (w.win = '24h' AND dupes."firstSeen" >= ${oneDayAgo})
       OR (w.win = '7d'  AND dupes."firstSeen" >= ${sevenDaysAgo})
    GROUP BY w.win
  `;

  const bounceMap: Record<string, number> = {};
  for (const row of bounceCounts) {
    bounceMap[row.win] = Number(row.cnt);
  }

  // Recent events: last 20 COOLDOWN_SKIPPED / STAMP_SKIPPED in the last 24h
  const recentSkips = await prisma.routingLog.findMany({
    where: {
      orgId,
      status: { in: ["COOLDOWN_SKIPPED", "STAMP_SKIPPED"] as any },
      createdAt: { gte: oneDayAgo },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      sfdcRecordId: true,
      objectType: true,
      ruleName: true,
      status: true,
      createdAt: true,
    },
  });

  // Recent breached records (SUCCESS 2+ times within 60s, last 24h)
  const recentBreached = await prisma.$queryRaw<
    {
      sfdcRecordId: string;
      objectType: string;
      cnt: bigint;
      firstSeen: Date;
      lastSeen: Date;
      ruleName: string | null;
    }[]
  >`
    SELECT
      "sfdcRecordId",
      MIN("objectType") AS "objectType",
      COUNT(*) AS cnt,
      MIN("createdAt") AS "firstSeen",
      MAX("createdAt") AS "lastSeen",
      MIN("ruleName") AS "ruleName"
    FROM "routing_logs"
    WHERE "orgId" = ${orgId}
      AND "status" = 'SUCCESS'
      AND "createdAt" >= ${oneDayAgo}
    GROUP BY "sfdcRecordId"
    HAVING COUNT(*) >= 2
       AND MAX("createdAt") - MIN("createdAt") < INTERVAL '60 seconds'
    ORDER BY MAX("createdAt") DESC
    LIMIT 20
  `;

  const recentEvents = [
    ...recentSkips.map((r) => ({
      sfdcRecordId: r.sfdcRecordId,
      objectType: r.objectType,
      count: 1,
      firstSeen: r.createdAt.toISOString(),
      lastSeen: r.createdAt.toISOString(),
      ruleName: r.ruleName,
      status: r.status,
    })),
    ...recentBreached.map((r) => ({
      sfdcRecordId: r.sfdcRecordId,
      objectType: r.objectType,
      count: Number(r.cnt),
      firstSeen: r.firstSeen.toISOString(),
      lastSeen: r.lastSeen.toISOString(),
      ruleName: r.ruleName,
      status: "BREACHED" as const,
    })),
  ]
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, 20);

  return NextResponse.json({
    cooldownSkips: { last1h: cooldown1h, last24h: cooldown24h, last7d: cooldown7d },
    stampSkips: { last1h: stamp1h, last24h: stamp24h, last7d: stamp7d },
    recursiveBounces: {
      last1h: bounceMap["1h"] ?? 0,
      last24h: bounceMap["24h"] ?? 0,
      last7d: bounceMap["7d"] ?? 0,
    },
    recentEvents,
  });
}
