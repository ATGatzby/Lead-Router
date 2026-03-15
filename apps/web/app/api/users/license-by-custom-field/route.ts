import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// POST /api/users/license-by-custom-field — license users where a boolean custom field is true
// NOTE: This requires the custom field to be synced to User records.
// For now, this uses a raw SQL query against a JSONB customFields column or
// falls back to matching users who have the field value synced.
export async function POST(req: NextRequest) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorSfdcId, userName: actorName } = actor;

    const body = await req.json();
    const { fieldName, fieldValue } = body as { fieldName: string; fieldValue?: string };

    if (!fieldName || typeof fieldName !== "string") {
      return NextResponse.json({ error: "fieldName must be a non-empty string" }, { status: 400 });
    }

    const matchValue = fieldValue ?? "true";

    // Query users whose custom field value matches
    // Custom fields are stored on the User record after SFDC sync as JSONB
    const matchingUsers = await prisma.$queryRaw<{ id: string; isLicensed: boolean }[]>`
      SELECT id, "isLicensed"
      FROM users
      WHERE "orgId" = ${orgId}
        AND "isActive" = true
        AND "customFields"->>${fieldName} = ${matchValue}
    `;

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
        data: { isLicensed: true, licensedVia: "custom_field" },
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
          action: "LICENSED_BY_CUSTOM_FIELD",
          entityType: "User",
          entityId: idsToLicense.join(","),
          beforeState: undefined,
          afterState: { fieldName, userIds: idsToLicense, licensedVia: "custom_field" },
        },
      }),
    ]);

    return NextResponse.json({
      affected: idsToLicense.length,
      totalMatched: matchingUsers.length,
    });
  } catch (err) {
    console.error("POST /api/users/license-by-custom-field error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
