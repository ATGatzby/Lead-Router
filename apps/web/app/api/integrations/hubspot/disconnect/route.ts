import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

/**
 * POST /api/integrations/hubspot/disconnect
 * Clears all HubSpot OAuth credentials from the org.
 */
export async function POST() {
  try {
    const orgId = await getOrgIdFromHeaders();

    await prisma.organization.update({
      where: { id: orgId },
      data: {
        hubspotPortalId: null,
        hubspotAppId: null,
        hubspotSubscriptionId: null,
        oauthAccessToken: null,
        oauthRefreshToken: null,
        fieldsSyncedAt: null,
        onboardingDone: false,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST /api/integrations/hubspot/disconnect error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
