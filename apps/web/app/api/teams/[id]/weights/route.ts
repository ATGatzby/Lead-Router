import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// PUT /api/teams/:id/weights — bulk update member weights
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;
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

    const body = await req.json();
    const { mode, weights } = body;

    // Validate mode
    if (mode !== "percentage" && mode !== "points") {
      return NextResponse.json(
        { error: "mode must be 'percentage' or 'points'" },
        { status: 400 }
      );
    }

    // Validate weights is a non-empty object
    if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
      return NextResponse.json(
        { error: "weights must be an object mapping userId to weight" },
        { status: 400 }
      );
    }

    const userIds = Object.keys(weights);
    if (userIds.length === 0) {
      return NextResponse.json(
        { error: "weights must not be empty" },
        { status: 400 }
      );
    }

    // Validate all values are non-negative integers
    for (const uid of userIds) {
      const val = weights[uid];
      if (!Number.isInteger(val) || val < 0) {
        return NextResponse.json(
          { error: `weight for ${uid} must be a non-negative integer` },
          { status: 400 }
        );
      }
    }

    // Validate all userIds are members of the team
    const members = await prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true },
    });
    const memberUserIds = new Set(members.map((m) => m.userId));

    for (const uid of userIds) {
      if (!memberUserIds.has(uid)) {
        return NextResponse.json(
          { error: `User ${uid} is not a member of this team` },
          { status: 400 }
        );
      }
    }

    // Validate weights sum
    const sum = userIds.reduce((acc, uid) => acc + weights[uid], 0);
    const expectedSum = mode === "percentage" ? 100 : 10;
    if (sum !== expectedSum) {
      return NextResponse.json(
        { error: `Weights must sum to ${expectedSum} for ${mode} mode (got ${sum})` },
        { status: 400 }
      );
    }

    // Update all member weights in a transaction
    await prisma.$transaction(
      userIds.map((uid) =>
        prisma.teamMember.update({
          where: { teamId_userId: { teamId, userId: uid } },
          data: { weight: weights[uid] },
        })
      )
    );

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "WEIGHTS_UPDATED",
        entityType: "RoundRobinTeam",
        entityId: teamId,
        afterState: { mode, weights },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PUT /api/teams/:id/weights error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
