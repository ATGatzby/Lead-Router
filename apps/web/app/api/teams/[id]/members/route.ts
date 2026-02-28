import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// POST /api/teams/:id/members — add one or more licensed users to a team
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const team = await prisma.roundRobinTeam.findFirst({
      where: { id: teamId, orgId },
      select: { id: true, name: true },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const body = await req.json();
    const userIds: string[] = body.userIds ?? [];

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: "userIds must be a non-empty array" }, { status: 400 });
    }

    // Verify all users are licensed in this org
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, orgId, isLicensed: true, isActive: true },
      select: { id: true, name: true },
    });

    if (users.length !== userIds.length) {
      return NextResponse.json(
        { error: "One or more users not found or not licensed" },
        { status: 400 }
      );
    }

    // Upsert members — skip if already in team
    const added: string[] = [];
    for (const user of users) {
      const existing = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: user.id } },
      });

      if (!existing) {
        await prisma.teamMember.create({
          data: { teamId, userId: user.id, status: "ACTIVE" },
        });
        added.push(user.id);

        await prisma.auditLog.create({
          data: {
            orgId,
            actorId,
            actorName,
            action: "MEMBER_ADDED",
            entityType: "TeamMember",
            entityId: `${teamId}:${user.id}`,
            afterState: { teamId, userId: user.id, userName: user.name },
          },
        });
      }
    }

    return NextResponse.json({ added: added.length, skipped: userIds.length - added.length });
  } catch (err) {
    console.error("POST /api/teams/:id/members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
