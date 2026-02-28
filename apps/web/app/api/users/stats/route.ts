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

    return NextResponse.json({
      seatsPurchased: org.seatsPurchased,
      seatsUsed,
    });
  } catch (err) {
    console.error("GET /api/users/stats error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
