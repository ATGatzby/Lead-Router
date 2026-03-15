import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// POST /api/users/license-by-role — license all users matching given roles
export async function POST(req: NextRequest) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorSfdcId, userName: actorName } = actor;

    const body = await req.json();
    const { roles } = body as { roles: string[] };

    if (!Array.isArray(roles) || roles.length === 0) {
      return NextResponse.json({ error: "roles must be a non-empty array" }, { status: 400 });
    }

    // Find unlicensed active users matching these roles
    const matchingUsers = await prisma.user.findMany({
      where: { orgId, role: { in: roles }, isActive: true },
      select: { id: true, isLicensed: true },
    });

    const toLicense = matchingUsers.filter((u) => !u.isLicensed);
    if (toLicense.length === 0) {
      return NextResponse.json({ affected: 0, totalMatched: matchingUsers.length });
    }

    // Seat cap check
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { seatsPurchased: true },
    });
    const seatsUsed = await prisma.user.count({
      where: { orgId, isLicensed: true, isActive: true },
    });
    const available = org.seatsPurchased - seatsUsed;
    if (toLicense.length > available) {
      return NextResponse.json(
        {
          error: "seat_cap_exceeded",
          seatsPurchased: org.seatsPurchased,
          seatsUsed,
          requested: toLicense.length,
          available,
        },
        { status: 402 }
      );
    }

    const idsToLicense = toLicense.map((u) => u.id);
    await prisma.$transaction([
      prisma.user.updateMany({
        where: { id: { in: idsToLicense } },
        data: { isLicensed: true, licensedVia: "role" },
      }),
      prisma.organization.update({
        where: { id: orgId },
        data: { seatsUsed: { increment: idsToLicense.length } },
      }),
      prisma.auditLog.create({
        data: {
          orgId,
          actorId: actorSfdcId,
          actorName,
          action: "LICENSED_BY_ROLE",
          entityType: "User",
          entityId: idsToLicense.join(","),
          beforeState: undefined,
          afterState: { roles, userIds: idsToLicense, licensedVia: "role" },
        },
      }),
    ]);

    return NextResponse.json({
      affected: idsToLicense.length,
      totalMatched: matchingUsers.length,
    });
  } catch (err) {
    console.error("POST /api/users/license-by-role error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
