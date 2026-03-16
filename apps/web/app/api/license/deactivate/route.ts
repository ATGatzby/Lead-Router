import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { requireSession, requireRole, getOrgIdFromHeaders } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { setLicenseTierOverride } from "@/lib/license";

export async function DELETE(_req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole(session, "ADMIN");
    const orgId = await getOrgIdFromHeaders();

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        licenseKey: null,
        licenseTier: null,
        licenseValidUntil: null,
        licenseActivatedAt: null,
        plan: "FREE",
        seatsPurchased: 3,
      },
    });

    setLicenseTierOverride("free");

    const redis = getRedis();
    await redis.del("license:key");

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId: session.appUserId,
        actorName: session.userName,
        action: "LICENSE_DEACTIVATED",
        entityType: "Organization",
        entityId: orgId,
        afterState: {},
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === "Insufficient permissions") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error.message === "Not authenticated" || error.message === "Session expired") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("License deactivation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
