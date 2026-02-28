import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";
import { getRedis } from "@/lib/redis";

// POST /api/teams/:id/reset-pointer — manually reset rotation to position 0
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: teamId } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const team = await prisma.roundRobinTeam.findFirst({
      where: { id: teamId, orgId },
      select: { id: true, name: true, pointerIndex: true },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Reset DB pointer (source of truth for UI display)
    await prisma.roundRobinTeam.update({
      where: { id: teamId },
      data: { pointerIndex: 0 },
    });

    // Reset Redis pointer (authoritative for routing)
    try {
      const redis = getRedis();
      await redis.connect().catch(() => {}); // lazyConnect — swallow if already connected
      await redis.set(`rr:${orgId}:${teamId}:pointer`, 0);
    } catch (redisErr) {
      // Redis may not be running in all environments; log but don't fail the request
      console.warn("[reset-pointer] Redis unavailable, only DB pointer reset:", redisErr);
    }

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "POINTER_RESET",
        entityType: "RoundRobinTeam",
        entityId: teamId,
        beforeState: { pointerIndex: team.pointerIndex },
        afterState: { pointerIndex: 0 },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST /api/teams/:id/reset-pointer error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
