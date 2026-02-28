import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@lead-routing/db";

export async function GET() {
  const session = await getSession();
  if (!session.orgId) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const org = await prisma.organization.findUnique({
    where: { id: session.orgId },
    select: {
      id: true,
      sfdcOrgId: true,
      plan: true,
      isActive: true,
      seatsPurchased: true,
      seatsUsed: true,
      onboardingDone: true,
    },
  });

  return NextResponse.json({
    user: {
      id: session.appUserId,
      name: session.userName,
      email: session.userEmail,
    },
    org,
  });
}
