import { NextRequest, NextResponse } from "next/server";
import { prisma, getPlanLimits } from "@lead-routing/db";

// PUT /api/admin/orgs/[id]/plan
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { plan } = await req.json();

    if (!plan || !["FREE", "PAID"].includes(plan)) {
      return NextResponse.json({ error: "Invalid plan. Must be FREE or PAID." }, { status: 400 });
    }

    const limits = getPlanLimits(plan as "FREE" | "PAID");
    const org = await prisma.organization.update({
      where: { id },
      data: {
        plan: plan as "FREE" | "PAID",
        seatsPurchased: limits.seats,
      },
      select: { id: true, plan: true, seatsPurchased: true },
    });

    return NextResponse.json({ org });
  } catch (err) {
    console.error("PUT /api/admin/orgs/[id]/plan error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
