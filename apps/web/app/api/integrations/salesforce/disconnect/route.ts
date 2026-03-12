import { NextResponse } from "next/server";
import { prisma, Prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

/**
 * POST /api/integrations/salesforce/disconnect
 * Clears all Salesforce OAuth credentials from the org.
 */
export async function POST() {
  try {
    const orgId = await getOrgIdFromHeaders();

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        sfdcOrgId: null,
        sfdcInstanceUrl: null,
        oauthAccessToken: null,
        oauthRefreshToken: null,
        packageDeployedAt: null,
        packageDeployId: null,
        packageVersion: null,
        objectConfig: Prisma.DbNull,
        fieldsSyncedAt: null,
        onboardingDone: false,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST /api/integrations/salesforce/disconnect error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
