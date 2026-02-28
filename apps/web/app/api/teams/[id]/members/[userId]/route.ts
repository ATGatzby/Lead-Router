import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// PATCH /api/teams/:id/members/:userId — toggle member status (ACTIVE ↔ PAUSED)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: teamId, userId } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    // Verify team belongs to org
    const team = await prisma.roundRobinTeam.findFirst({
      where: { id: teamId, orgId },
      select: { id: true },
    });
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const member = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { id: true, status: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    const body = await req.json();
    const newStatus: "ACTIVE" | "PAUSED" = body.status;

    if (newStatus !== "ACTIVE" && newStatus !== "PAUSED") {
      return NextResponse.json(
        { error: "status must be ACTIVE or PAUSED" },
        { status: 400 }
      );
    }

    await prisma.teamMember.update({
      where: { teamId_userId: { teamId, userId } },
      data: { status: newStatus },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: newStatus === "PAUSED" ? "MEMBER_PAUSED" : "MEMBER_ACTIVATED",
        entityType: "TeamMember",
        entityId: `${teamId}:${userId}`,
        beforeState: { status: member.status },
        afterState: { status: newStatus },
      },
    });

    return NextResponse.json({ success: true, status: newStatus });
  } catch (err) {
    console.error("PATCH /api/teams/:id/members/:userId error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/teams/:id/members/:userId — remove member from team
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id: teamId, userId } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const team = await prisma.roundRobinTeam.findFirst({
      where: { id: teamId, orgId },
      select: { id: true },
    });
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const member = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId } },
      select: { id: true },
    });
    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    await prisma.teamMember.delete({
      where: { teamId_userId: { teamId, userId } },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "MEMBER_REMOVED",
        entityType: "TeamMember",
        entityId: `${teamId}:${userId}`,
        beforeState: { teamId, userId },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/teams/:id/members/:userId error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
