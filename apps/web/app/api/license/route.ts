import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { getLicenseTier, getTierLimits } from "@/lib/license";

// GET /api/license — Returns current tier info + usage counts
export async function GET(_req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();

    const [ruleCount, licensedUserCount, org] = await Promise.all([
      prisma.routingRule.count({ where: { orgId } }),
      prisma.user.count({ where: { orgId, isLicensed: true } }),
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { licenseKey: true, licenseTier: true, licenseValidUntil: true, licenseActivatedAt: true, aiProvider: true, aiApiKey: true },
      }),
    ]);

    // DB-activated license takes precedence over env var
    const tier = (org?.licenseTier === "pro" ? "pro" : null) ?? getLicenseTier();
    const limits = getTierLimits(tier);

    return NextResponse.json({
      tier,
      limits: {
        ...limits,
        // Infinity is not valid JSON — send -1 as "unlimited" sentinel
        maxRules: limits.maxRules === Infinity ? -1 : limits.maxRules,
        maxSeats: limits.maxSeats === Infinity ? -1 : limits.maxSeats,
      },
      usage: {
        rules: ruleCount,
        seats: licensedUserCount,
        orgs: 1,
      },
      licenseKey: org?.licenseKey
        ? org.licenseKey.slice(0, 4) + "••••" + org.licenseKey.slice(-4)
        : process.env.LICENSE_KEY
          ? "****" + (process.env.LICENSE_KEY.slice(-8) || "")
          : null,
      activatedAt: org?.licenseActivatedAt?.toISOString() ?? null,
      validUntil: org?.licenseValidUntil?.toISOString() ?? null,
      hasAiKey: !!org?.aiApiKey,
      aiProvider: org?.aiProvider ?? null,
    });
  } catch (err) {
    console.error("GET /api/license error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
