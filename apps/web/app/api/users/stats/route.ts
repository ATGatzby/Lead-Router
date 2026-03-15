import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/users/stats — seat usage for the authenticated org
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { seatsPurchased: true, seatsUsed: true },
    });

    // Re-derive seatsUsed from the source of truth to avoid drift
    const seatsUsed = await prisma.user.count({
      where: { orgId, isLicensed: true, isActive: true },
    });

    // Breakdown by licensing method
    const [byRole, byProfile, byCustomField, byIndividual, licensedQueues] = await Promise.all([
      prisma.user.count({ where: { orgId, isLicensed: true, isActive: true, licensedVia: "role" } }),
      prisma.user.count({ where: { orgId, isLicensed: true, isActive: true, licensedVia: "profile" } }),
      prisma.user.count({ where: { orgId, isLicensed: true, isActive: true, licensedVia: "custom_field" } }),
      prisma.user.count({ where: { orgId, isLicensed: true, isActive: true, OR: [{ licensedVia: "individual" }, { licensedVia: null }] } }),
      prisma.sfdcQueue.count({ where: { orgId, isLicensed: true } }),
    ]);

    return NextResponse.json({
      seatsPurchased: org.seatsPurchased,
      seatsUsed,
      breakdown: {
        individual: byIndividual,
        byRole,
        byProfile,
        byCustomField,
        licensedQueues,
      },
    });
  } catch (err) {
    console.error("GET /api/users/stats error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
