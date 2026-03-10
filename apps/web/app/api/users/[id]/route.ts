import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "@lead-routing/db";
import { getActorFromHeaders, requireSession, requireRole } from "@/lib/auth";

// DELETE /api/users/:id — permanently remove a user from the system (ADMIN only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireRole(session, "ADMIN");

    const { id } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorSfdcId, userName: actorName } = actor;

    const user = await prisma.user.findFirst({
      where: { id, orgId },
      select: { id: true, name: true, email: true, isLicensed: true },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    await prisma.$transaction([
      // Remove all team memberships
      prisma.teamMember.deleteMany({ where: { userId: id } }),
      // Decrement seat count if the user was licensed
      ...(user.isLicensed
        ? [
            prisma.organization.update({
              where: { id: orgId },
              data: { seatsUsed: { decrement: 1 } },
            }),
          ]
        : []),
      // Audit log before deletion
      prisma.auditLog.create({
        data: {
          orgId,
          actorId: actorSfdcId,
          actorName,
          action: "USER_DELETED",
          entityType: "User",
          entityId: id,
          beforeState: { name: user.name, email: user.email, isLicensed: user.isLicensed },
          afterState: Prisma.JsonNull,
        },
      }),
      // Delete the user
      prisma.user.delete({ where: { id } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/users/:id error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
