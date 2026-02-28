import { NextRequest, NextResponse } from "next/server";
import { prisma, getPlanLimits } from "@lead-routing/db";

// GET /api/admin/orgs/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const org = await prisma.organization.findUnique({
      where: { id },
      select: {
        id: true,
        sfdcOrgId: true,
        plan: true,
        isActive: true,
        seatsPurchased: true,
        seatsUsed: true,
        routingQuotaUsed: true,
        quotaResetAt: true,
        createdAt: true,
        billingInfo: true,
      },
    });

    if (!org) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const plan = org.plan as "FREE" | "PAID";
    return NextResponse.json({
      org: {
        ...org,
        routingQuotaLimit: getPlanLimits(plan).routingLeadsPerMonth,
        quotaPercent: Math.round(
          (org.routingQuotaUsed / getPlanLimits(plan).routingLeadsPerMonth) * 100
        ),
      },
    });
  } catch (err) {
    console.error("GET /api/admin/orgs/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
