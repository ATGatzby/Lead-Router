import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";

// PUT /api/admin/orgs/[id]/seats
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { seatsPurchased } = await req.json();

    if (typeof seatsPurchased !== "number" || seatsPurchased < 1 || seatsPurchased > 1000) {
      return NextResponse.json(
        { error: "seatsPurchased must be a number between 1 and 1000" },
        { status: 400 }
      );
    }

    const org = await prisma.organization.update({
      where: { id },
      data: { seatsPurchased },
      select: { id: true, seatsPurchased: true },
    });

    return NextResponse.json({ org });
  } catch (err) {
    console.error("PUT /api/admin/orgs/[id]/seats error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
