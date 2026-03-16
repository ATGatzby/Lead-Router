import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { getTierLimits, upgradeRequiredResponse } from "@/lib/license";

/**
 * GET /api/integrations/salesforce/objects
 *
 * Returns the object configuration for the org.
 */
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { objectConfig: true },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({
      objectConfig: org.objectConfig ?? null,
    });
  } catch (err) {
    console.error("GET /api/integrations/salesforce/objects error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/integrations/salesforce/objects
 *
 * Updates the object configuration for the org.
 * Body: { objectConfig: Record<string, { enabled: boolean }> }
 */
export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();

    const body = await req.json();

    if (!body.objectConfig || typeof body.objectConfig !== "object") {
      return NextResponse.json(
        { error: "Invalid body: objectConfig must be an object" },
        { status: 400 }
      );
    }

    // Validate shape: each value should have an `enabled` boolean
    for (const [key, value] of Object.entries(body.objectConfig)) {
      if (typeof value !== "object" || value === null || typeof (value as any).enabled !== "boolean") {
        return NextResponse.json(
          { error: `Invalid objectConfig entry for "${key}": must have { enabled: boolean }` },
          { status: 400 }
        );
      }
    }

    // Tier check: prevent free tier from enabling Contact/Account objects
    const limits = getTierLimits();
    for (const [objKey, config] of Object.entries(body.objectConfig)) {
      if ((config as any).enabled && !limits.allowedTriggers.includes(objKey.toUpperCase())) {
        return upgradeRequiredResponse(`${objKey} routing`);
      }
    }

    const org = await prisma.organization.update({
      where: { id: orgId },
      data: { objectConfig: body.objectConfig },
      select: { objectConfig: true },
    });

    return NextResponse.json({ objectConfig: org.objectConfig });
  } catch (err) {
    console.error("POST /api/integrations/salesforce/objects error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
