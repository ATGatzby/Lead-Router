import { NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";

/**
 * GET /api/integrations/salesforce/status
 *
 * Returns the full Salesforce integration status for the org.
 */
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        sfdcOrgId: true,
        sfdcInstanceUrl: true,
        oauthAccessToken: true,
        packageDeployedAt: true,
        packageVersion: true,
        objectConfig: true,
        fieldsSyncedAt: true,
      },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json({
      connected: Boolean(org.oauthAccessToken && org.sfdcInstanceUrl),
      sfdcOrgId: org.sfdcOrgId ?? null,
      sfdcInstanceUrl: org.sfdcInstanceUrl ?? null,
      packageDeployedAt: org.packageDeployedAt?.toISOString() ?? null,
      packageVersion: org.packageVersion ?? null,
      objectConfig: org.objectConfig ?? null,
      fieldsSyncedAt: org.fieldsSyncedAt?.toISOString() ?? null,
    });
  } catch (err) {
    console.error("GET /api/integrations/salesforce/status error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
