import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// POST /api/users/:id/de-license — remove a user's license + cascade Round Robin removal
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorSfdcId, userName: actorName } = actor;

    const user = await prisma.user.findFirst({
      where: { id, orgId },
      select: { id: true, name: true, isLicensed: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!user.isLicensed) {
      return NextResponse.json({ message: "Already unlicensed" });
    }

    // Find which Round Robin teams this user is an active member of
    const activeMemberships = await prisma.teamMember.findMany({
      where: { userId: id, status: "ACTIVE" },
      include: { team: { select: { name: true } } },
    });
    const removedFromTeams = activeMemberships.map((m) => m.team.name);

    await prisma.$transaction([
      // De-license the user
      prisma.user.update({
        where: { id },
        data: { isLicensed: false },
      }),
      // Pause all active Round Robin memberships (preserve history, don't delete)
      prisma.teamMember.updateMany({
        where: { userId: id, status: "ACTIVE" },
        data: { status: "PAUSED" },
      }),
      // Decrement seat count (floor at 0)
      prisma.organization.update({
        where: { id: orgId },
        data: { seatsUsed: { decrement: 1 } },
      }),
      // Audit log
      prisma.auditLog.create({
        data: {
          orgId,
          actorId: actorSfdcId,
          actorName,
          action: "USER_DE_LICENSED",
          entityType: "User",
          entityId: id,
          beforeState: { isLicensed: true },
          afterState: { isLicensed: false, removedFromTeams },
        },
      }),
    ]);

    return NextResponse.json({ success: true, removedFromTeams });
  } catch (err) {
    console.error("POST /api/users/:id/de-license error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
