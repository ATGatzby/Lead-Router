import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders, getActorFromHeaders } from "@/lib/auth";

// GET /api/teams — list all teams for the org with member counts + assignment totals
export async function GET(_req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();

    const teams = await prisma.roundRobinTeam.findMany({
      where: { orgId },
      orderBy: { createdAt: "asc" },
      include: {
        members: {
          select: {
            status: true,
            assignmentCount: true,
          },
        },
      },
    });

    const result = teams.map((team) => {
      const memberCount = team.members.length;
      const activeCount = team.members.filter((m) => m.status === "ACTIVE").length;
      const totalAssigned = team.members.reduce((sum, m) => sum + m.assignmentCount, 0);

      return {
        id: team.id,
        name: team.name,
        description: team.description,
        memberCount,
        activeCount,
        totalAssigned,
        createdAt: team.createdAt,
      };
    });

    return NextResponse.json({ teams: result });
  } catch (err) {
    console.error("GET /api/teams error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/teams — create a new round robin team
export async function POST(req: NextRequest) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const body = await req.json();
    const name = (body.name ?? "").trim();
    const description = (body.description ?? "").trim() || null;

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const team = await prisma.roundRobinTeam.create({
      data: { orgId, name, description: description ?? undefined },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "TEAM_CREATED",
        entityType: "RoundRobinTeam",
        entityId: team.id,
        afterState: { name, description },
      },
    });

    return NextResponse.json({ team }, { status: 201 });
  } catch (err) {
    console.error("POST /api/teams error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
