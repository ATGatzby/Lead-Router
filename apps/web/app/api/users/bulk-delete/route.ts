import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// POST /api/users/bulk-delete — permanently remove multiple users
export async function POST(req: NextRequest) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorSfdcId, userName: actorName } = actor;

    const body: { userIds: string[] } = await req.json();
    const { userIds } = body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: "userIds must be a non-empty array" }, { status: 400 });
    }

    // Verify all users belong to this org
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, orgId },
      select: { id: true, name: true, email: true, isLicensed: true },
    });
    if (users.length === 0) {
      return NextResponse.json({ error: "No matching users found" }, { status: 404 });
    }

    const validIds = users.map((u) => u.id);
    const licensedCount = users.filter((u) => u.isLicensed).length;

    await prisma.$transaction([
      // Remove all team memberships for these users
      prisma.teamMember.deleteMany({ where: { userId: { in: validIds } } }),
      // Decrement seat count by the number of licensed users being deleted
      ...(licensedCount > 0
        ? [
            prisma.organization.update({
              where: { id: orgId },
              data: { seatsUsed: { decrement: licensedCount } },
            }),
          ]
        : []),
      // Audit log
      prisma.auditLog.create({
        data: {
          orgId,
          actorId: actorSfdcId,
          actorName,
          action: "BULK_DELETED",
          entityType: "User",
          entityId: validIds.join(","),
          beforeState: undefined,
          afterState: { deletedCount: validIds.length, licensedFreed: licensedCount },
        },
      }),
      // Delete the users
      prisma.user.deleteMany({ where: { id: { in: validIds } } }),
    ]);

    return NextResponse.json({ deleted: validIds.length, licensedFreed: licensedCount });
  } catch (err) {
    console.error("POST /api/users/bulk-delete error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
