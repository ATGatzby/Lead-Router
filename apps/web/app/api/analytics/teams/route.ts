import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { parseFilters } from "../filters";

interface MemberRow {
  teamId: string;
  assigneeId: string;
  assignee_name: string | null;
  target_weight: number | null;
  total: number;
}

interface MemberOut {
  assigneeId: string;
  assigneeName: string;
  total: number;
  targetWeight: number;
}

/**
 * Fairness score: how evenly the actual distribution matches the target
 * weights. 100 = perfectly proportional, 0 = worst case.
 */
function fairnessScore(members: MemberOut[]): number {
  if (members.length <= 1) return 100;

  const totalWeight = members.reduce((s, m) => s + m.targetWeight, 0);
  const totalRouted = members.reduce((s, m) => s + m.total, 0);
  if (totalRouted === 0 || totalWeight === 0) return 100;

  let maxDeviation = 0;
  for (const m of members) {
    const expected = m.targetWeight / totalWeight;
    const actual = m.total / totalRouted;
    maxDeviation = Math.max(maxDeviation, Math.abs(actual - expected));
  }

  // 0% deviation -> 100, >=50% deviation -> 0
  return Math.max(0, Math.round((1 - maxDeviation * 2) * 100));
}

/**
 * GET /api/analytics/teams
 *
 * Per-team fairness scores and per-member distribution breakdown.
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

    // Per-team totals (assigneeId IS NULL = team-level row)
    const teamsPromise = prisma.$queryRawUnsafe<any[]>(
      `
      SELECT
        a."teamId",
        t.name                             AS team_name,
        SUM(a."totalCount")::integer       AS total,
        SUM(a."successCount")::integer     AS success
      FROM routing_daily_aggregates a
      LEFT JOIN round_robin_teams t ON t.id = a."teamId"
      WHERE a."orgId" = $1 AND a.date >= $2 AND a.date <= $3
        AND a."teamId" IS NOT NULL
        AND a."assigneeId" IS NULL
        ${objectFilter}
      GROUP BY a."teamId", t.name
      ORDER BY total DESC
      `,
      ...params,
    );

    // Per-member breakdown within teams
    const membersPromise = prisma.$queryRawUnsafe<MemberRow[]>(
      `
      SELECT
        a."teamId",
        a."assigneeId",
        u.name                        AS assignee_name,
        tm.weight                     AS target_weight,
        SUM(a."totalCount")::integer  AS total
      FROM routing_daily_aggregates a
      LEFT JOIN users u ON u."sfdcUserId" = a."assigneeId"
      LEFT JOIN team_members tm ON tm."teamId" = a."teamId" AND tm."userId" = u.id
      WHERE a."orgId" = $1 AND a.date >= $2 AND a.date <= $3
        AND a."teamId" IS NOT NULL
        AND a."assigneeId" IS NOT NULL
        ${objectFilter}
      GROUP BY a."teamId", a."assigneeId", u.name, tm.weight
      ORDER BY total DESC
      `,
      ...params,
    );

    const [teams, members] = await Promise.all([teamsPromise, membersPromise]);

    // Group members by teamId
    const membersByTeam: Record<string, MemberOut[]> = {};
    for (const m of members) {
      const tid = m.teamId;
      if (!membersByTeam[tid]) membersByTeam[tid] = [];
      membersByTeam[tid].push({
        assigneeId: m.assigneeId,
        assigneeName: m.assignee_name || m.assigneeId,
        total: Number(m.total),
        targetWeight: Number(m.target_weight ?? 1),
      });
    }

    return NextResponse.json({
      teams: teams.map((t) => {
        const teamId = t.teamId as string;
        const tMembers = membersByTeam[teamId] || [];
        const teamTotal = Number(t.total);
        const totalWeight = tMembers.reduce((s, m) => s + m.targetWeight, 0);

        return {
          teamId,
          teamName: t.team_name,
          total: teamTotal,
          success: Number(t.success),
          fairnessScore: fairnessScore(tMembers),
          members: tMembers.map((m) => ({
            ...m,
            actualPercent:
              teamTotal > 0
                ? Math.round((m.total / teamTotal) * 1000) / 10
                : 0,
            targetPercent:
              totalWeight > 0
                ? Math.round((m.targetWeight / totalWeight) * 1000) / 10
                : 0,
          })),
        };
      }),
    });
  } catch (err) {
    console.error("GET /api/analytics/teams error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
