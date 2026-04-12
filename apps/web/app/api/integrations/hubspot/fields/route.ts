import { NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { syncHubSpotFields } from "@lead-routing/hubspot";

/**
 * POST /api/integrations/hubspot/fields
 *
 * Session-authenticated field sync for the HubSpot Integrations UI.
 * Syncs Contact, Company, and Deal fields, then updates org.fieldsSyncedAt.
 */
export async function POST() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        hubspotPortalId: true,
        oauthAccessToken: true,
      },
    });

    if (!org || !org.hubspotPortalId) {
      return NextResponse.json({ error: "HubSpot not connected" }, { status: 400 });
    }
    if (!org.oauthAccessToken) {
      return NextResponse.json({ error: "HubSpot credentials missing" }, { status: 400 });
    }

    const totalSynced = await syncHubSpotFields(org.oauthAccessToken, orgId, prisma);

    // syncHubSpotFields already updates fieldsSyncedAt, just return results
    return NextResponse.json({
      success: true,
      counts: { Contact: 0, Company: 0, Deal: 0 }, // approximate — syncHubSpotFields doesn't return per-object counts
      total: totalSynced,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("POST /api/integrations/hubspot/fields error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
