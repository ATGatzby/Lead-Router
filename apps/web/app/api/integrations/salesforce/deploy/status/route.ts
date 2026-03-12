import { NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";

/**
 * GET /api/integrations/salesforce/deploy/status
 *
 * Returns the current package deploy status for the org.
 */
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        packageDeployedAt: true,
        packageDeployId: true,
        packageVersion: true,
      },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({
      packageDeployedAt: org.packageDeployedAt?.toISOString() ?? null,
      packageDeployId: org.packageDeployId ?? null,
      packageVersion: org.packageVersion ?? null,
    });
  } catch (err) {
    console.error("GET /api/integrations/salesforce/deploy/status error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
