import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// POST /api/users/:id/license — enable a user's license
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
      select: { id: true, name: true, isLicensed: true, isActive: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    if (!user.isActive) {
      return NextResponse.json({ error: "User is no longer active in Salesforce" }, { status: 400 });
    }
    if (user.isLicensed) {
      return NextResponse.json({ message: "Already licensed" });
    }

    // Seat cap check
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { seatsPurchased: true },
    });
    const seatsUsed = await prisma.user.count({
      where: { orgId, isLicensed: true, isActive: true },
    });
    if (seatsUsed >= org.seatsPurchased) {
      return NextResponse.json(
        {
          error: "seat_cap_exceeded",
          seatsPurchased: org.seatsPurchased,
          seatsUsed,
        },
        { status: 402 }
      );
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { isLicensed: true },
      }),
      prisma.organization.update({
        where: { id: orgId },
        data: { seatsUsed: { increment: 1 } },
      }),
      prisma.auditLog.create({
        data: {
          orgId,
          actorId: actorSfdcId,
          actorName,
          action: "USER_LICENSED",
          entityType: "User",
          entityId: id,
          beforeState: { isLicensed: false },
          afterState: { isLicensed: true },
        },
      }),
    ]);

    return NextResponse.json({ success: true, seatsUsed: seatsUsed + 1 });
  } catch (err) {
    console.error("POST /api/users/:id/license error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
