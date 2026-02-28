import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

interface BulkLicenseBody {
  userIds: string[];
  action: "license" | "de-license";
}

// POST /api/users/bulk-license — license or de-license multiple users at once
export async function POST(req: NextRequest) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorSfdcId, userName: actorName } = actor;

    const body: BulkLicenseBody = await req.json();
    const { userIds, action } = body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: "userIds must be a non-empty array" }, { status: 400 });
    }
    if (action !== "license" && action !== "de-license") {
      return NextResponse.json({ error: "action must be 'license' or 'de-license'" }, { status: 400 });
    }

    // Verify all users belong to this org
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, orgId },
      select: { id: true, isLicensed: true, isActive: true },
    });
    if (users.length !== userIds.length) {
      return NextResponse.json({ error: "One or more users not found" }, { status: 404 });
    }

    if (action === "license") {
      const toActivate = users.filter((u) => !u.isLicensed && u.isActive);
      if (toActivate.length === 0) {
        return NextResponse.json({ affected: 0 });
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
      if (toActivate.length > available) {
        return NextResponse.json(
          {
            error: "seat_cap_exceeded",
            seatsPurchased: org.seatsPurchased,
            seatsUsed,
            requested: toActivate.length,
            available,
          },
          { status: 402 }
        );
      }

      const idsToActivate = toActivate.map((u) => u.id);
      await prisma.$transaction([
        prisma.user.updateMany({
          where: { id: { in: idsToActivate } },
          data: { isLicensed: true },
        }),
        prisma.organization.update({
          where: { id: orgId },
          data: { seatsUsed: { increment: idsToActivate.length } },
        }),
        prisma.auditLog.create({
          data: {
            orgId,
            actorId: actorSfdcId,
            actorName,
            action: "BULK_LICENSED",
            entityType: "User",
            entityId: idsToActivate.join(","),
            beforeState: undefined,
            afterState: { userIds: idsToActivate, isLicensed: true },
          },
        }),
      ]);

      return NextResponse.json({ affected: idsToActivate.length });
    } else {
      // de-license
      const toDeactivate = users.filter((u) => u.isLicensed);
      if (toDeactivate.length === 0) {
        return NextResponse.json({ affected: 0 });
      }

      const idsToDeactivate = toDeactivate.map((u) => u.id);

      // Pause active Round Robin memberships
      await prisma.teamMember.updateMany({
        where: { userId: { in: idsToDeactivate }, status: "ACTIVE" },
        data: { status: "PAUSED" },
      });

      await prisma.$transaction([
        prisma.user.updateMany({
          where: { id: { in: idsToDeactivate } },
          data: { isLicensed: false },
        }),
        prisma.organization.update({
          where: { id: orgId },
          data: { seatsUsed: { decrement: idsToDeactivate.length } },
        }),
        prisma.auditLog.create({
          data: {
            orgId,
            actorId: actorSfdcId,
            actorName,
            action: "BULK_DE_LICENSED",
            entityType: "User",
            entityId: idsToDeactivate.join(","),
            beforeState: undefined,
            afterState: { userIds: idsToDeactivate, isLicensed: false },
          },
        }),
      ]);

      return NextResponse.json({ affected: idsToDeactivate.length });
    }
  } catch (err) {
    console.error("POST /api/users/bulk-license error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
