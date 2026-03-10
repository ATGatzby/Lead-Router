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
    const roles: string[] = body.roles ?? [];
    const profiles: string[] = body.profiles ?? [];

    const hasUserIds = Array.isArray(userIds) && userIds.length > 0;
    const hasRoles = Array.isArray(roles) && roles.length > 0;
    const hasProfiles = Array.isArray(profiles) && profiles.length > 0;

    if (!hasUserIds && !hasRoles && !hasProfiles) {
      return NextResponse.json(
        { error: "At least one of userIds, roles, or profiles must be provided" },
        { status: 400 }
      );
    }

    // Build the where clause based on what was provided
    let users: { id: string; name: string }[];

    if (hasUserIds) {
      users = await prisma.user.findMany({
        where: { id: { in: userIds }, orgId, isLicensed: true, isActive: true },
        select: { id: true, name: true },
      });

      if (users.length !== userIds.length) {
        return NextResponse.json(
          { error: "One or more users not found or not licensed" },
          { status: 400 }
        );
      }
    } else if (hasRoles) {
      users = await prisma.user.findMany({
        where: { orgId, isActive: true, isLicensed: true, role: { in: roles } },
        select: { id: true, name: true },
      });
    } else {
      users = await prisma.user.findMany({
        where: { orgId, isActive: true, isLicensed: true, profile: { in: profiles } },
        select: { id: true, name: true },
      });
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

    return NextResponse.json({ added: added.length, skipped: users.length - added.length });
  } catch (err) {
    console.error("POST /api/teams/:id/members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
