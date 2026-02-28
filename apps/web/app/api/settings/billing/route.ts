import { NextRequest, NextResponse } from "next/server";
import { prisma, getPlanLimits } from "@lead-routing/db";
import { getOrgIdFromHeaders, getActorFromHeaders } from "@/lib/auth";

// GET /api/settings/billing
export async function GET(_req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();

    const billing = await prisma.billingInfo.findUnique({
      where: { orgId },
    });

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        seatsPurchased: true,
        seatsUsed: true,
        plan: true,
        routingQuotaUsed: true,
        quotaResetAt: true,
      },
    });

    const plan = (org?.plan ?? "FREE") as "FREE" | "PAID";
    const routingQuotaLimit = getPlanLimits(plan).routingLeadsPerMonth;
    const routingQuotaUsed = org?.routingQuotaUsed ?? 0;

    return NextResponse.json({
      billing,
      seats: { seatsPurchased: org?.seatsPurchased, seatsUsed: org?.seatsUsed },
      quota: {
        plan,
        routingQuotaUsed,
        routingQuotaLimit,
        quotaResetAt: org?.quotaResetAt,
        quotaPercent: Math.round((routingQuotaUsed / routingQuotaLimit) * 100),
      },
    });
  } catch (err) {
    console.error("GET /api/settings/billing error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/settings/billing
export async function PUT(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const actor = await getActorFromHeaders();

    const body = await req.json();
    const { entityName, gstin, addressLine1, addressLine2, city, state, pinCode, invoiceEmail } = body;

    const before = await prisma.billingInfo.findUnique({ where: { orgId } });

    const billing = await prisma.billingInfo.upsert({
      where: { orgId },
      update: { entityName, gstin, addressLine1, addressLine2, city, state, pinCode, invoiceEmail },
      create: { orgId, entityName, gstin, addressLine1, addressLine2, city, state, pinCode, invoiceEmail },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId: actor.userId,
        actorName: actor.userName,
        action: "BILLING_UPDATED",
        entityType: "BillingInfo",
        entityId: billing.id,
        beforeState: before ? JSON.parse(JSON.stringify(before)) : undefined,
        afterState: JSON.parse(JSON.stringify(billing)),
      },
    });

    return NextResponse.json({ billing });
  } catch (err) {
    console.error("PUT /api/settings/billing error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
