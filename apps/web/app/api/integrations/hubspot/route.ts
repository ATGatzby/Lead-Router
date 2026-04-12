import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/integrations/hubspot — return org HubSpot integration data
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        hubspotPortalId: true,
        hubspotAppId: true,
        fieldsSyncedAt: true,
        createdAt: true,
      },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    return NextResponse.json(org);
  } catch (err) {
    console.error("GET /api/integrations/hubspot error:", err);
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
}
