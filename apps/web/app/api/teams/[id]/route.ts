import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders, getActorFromHeaders, requireSession, requireRole } from "@/lib/auth";

// GET /api/teams/:id — team detail with members + per-member stats
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orgId = await getOrgIdFromHeaders();

    const team = await prisma.roundRobinTeam.findFirst({
      where: { id, orgId },
      include: {
        members: {
          orderBy: { createdAt: "asc" },
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const activeMembers = team.members.filter((m) => m.status === "ACTIVE");
    const totalAssigned = team.members.reduce((sum, m) => sum + m.assignmentCount, 0);

    // Determine who is "next up" — pointer mod active member count
    const nextMemberIndex =
      activeMembers.length > 0 ? team.pointerIndex % activeMembers.length : null;
    const nextMember =
      nextMemberIndex !== null ? activeMembers[nextMemberIndex] : null;

    const members = team.members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      status: m.status,
      weight: m.weight,
      assignmentCount: m.assignmentCount,
      sharePercent:
        totalAssigned > 0
          ? Math.round((m.assignmentCount / totalAssigned) * 100)
          : 0,
      createdAt: m.createdAt,
    }));

    return NextResponse.json({
      team: {
        id: team.id,
        name: team.name,
        description: team.description,
        distributionType: team.distributionType,
        pointerIndex: team.pointerIndex,
        createdAt: team.createdAt,
        memberCount: team.members.length,
        activeCount: activeMembers.length,
        totalAssigned,
        nextMemberId: nextMember?.userId ?? null,
        nextMemberName: nextMember?.user.name ?? null,
        members,
      },
    });
  } catch (err) {
    console.error("GET /api/teams/:id error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/teams/:id — update team name / description
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const existing = await prisma.roundRobinTeam.findFirst({
      where: { id, orgId },
      select: { id: true, name: true, description: true, distributionType: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    const body = await req.json();

    const updateData: Record<string, string | null> = {};

    // Name is optional — only validate if provided
    if (body.name !== undefined) {
      const name = (body.name ?? "").trim();
      if (!name) {
        return NextResponse.json({ error: "name is required" }, { status: 400 });
      }
      updateData.name = name;
    }

    if (body.description !== undefined) {
      updateData.description = (body.description ?? "").trim() || null;
    }

    if (body.distributionType !== undefined) {
      if (body.distributionType !== "round-robin" && body.distributionType !== "weighted") {
        return NextResponse.json({ error: "distributionType must be 'round-robin' or 'weighted'" }, { status: 400 });
      }
      updateData.distributionType = body.distributionType;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updated = await prisma.roundRobinTeam.update({
      where: { id, orgId },
      data: updateData,
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "TEAM_UPDATED",
        entityType: "RoundRobinTeam",
        entityId: id,
        beforeState: { name: existing.name, description: existing.description, distributionType: existing.distributionType },
        afterState: updateData,
      },
    });

    return NextResponse.json({ team: updated });
  } catch (err) {
    console.error("PUT /api/teams/:id error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/teams/:id — delete team (ADMIN only, blocked if referenced by active rules)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireRole(session, "ADMIN");

    const { id } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const team = await prisma.roundRobinTeam.findFirst({
      where: { id, orgId },
      select: { id: true, name: true },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Delete guard — block if any ACTIVE routing rule references this team
    const activeRules = await prisma.routingRule.findMany({
      where: { assigneeTeamId: id, status: "ACTIVE" },
      select: { id: true, name: true },
    });

    if (activeRules.length > 0) {
      return NextResponse.json(
        {
          error: "Cannot delete team — referenced by active routing rules",
          rules: activeRules,
        },
        { status: 409 }
      );
    }

    await prisma.roundRobinTeam.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "TEAM_DELETED",
        entityType: "RoundRobinTeam",
        entityId: id,
        beforeState: { name: team.name },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/teams/:id error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
