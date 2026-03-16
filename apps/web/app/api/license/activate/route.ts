import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { requireSession, requireRole } from "@/lib/auth";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { getRedis } from "@/lib/redis";
import { setLicenseTierOverride } from "@/lib/license";
import { hostname } from "os";

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole(session, "ADMIN");
    const orgId = await getOrgIdFromHeaders();

    const { key } = await req.json();
    if (!key || typeof key !== "string") {
      return NextResponse.json(
        { error: "License key is required" },
        { status: 400 }
      );
    }

    const licenseApiUrl =
      process.env.LICENSE_API_URL ||
      "https://lead-routing-license.artyagi2011.workers.dev";

    let response: Response;
    try {
      response = await fetch(`${licenseApiUrl}/v1/licenses/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, fingerprint: hostname() }),
      });
    } catch {
      return NextResponse.json(
        { error: "License server unreachable. Try again later." },
        { status: 502 }
      );
    }

    const data = await response.json();

    if (!data.valid) {
      return NextResponse.json(
        { error: "Invalid or expired license key" },
        { status: 400 }
      );
    }

    const tier = data.tier === "pro" ? "pro" : "free";

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        licenseKey: key,
        licenseTier: tier,
        licenseValidUntil: data.validUntil ? new Date(data.validUntil) : null,
        licenseActivatedAt: new Date(),
        plan: tier === "pro" ? "PAID" : "FREE",
        seatsPurchased: tier === "pro" ? 9999 : 3,
      },
    });

    setLicenseTierOverride(tier);

    const redis = getRedis();
    await redis.set("license:key", key);

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId: session.appUserId,
        actorName: session.userName,
        action: "LICENSE_ACTIVATED",
        entityType: "Organization",
        entityId: orgId,
        afterState: { tier, validUntil: data.validUntil },
      },
    });

    return NextResponse.json({
      success: true,
      tier,
      validUntil: data.validUntil,
    });
  } catch (error: any) {
    if (error.message === "Insufficient permissions") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (error.message === "Not authenticated" || error.message === "Session expired") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("License activation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
