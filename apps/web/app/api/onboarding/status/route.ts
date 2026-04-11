import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/onboarding/status
// Returns checklist items for the sidebar onboarding widget.
export async function GET(_req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();

    const [org, licenseCount, fieldCount, activeRuleCount] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: orgId },
        select: { sfdcOrgId: true, hubspotPortalId: true, crmType: true, packageDeployedAt: true },
      }),
      prisma.user.count({ where: { orgId, isLicensed: true } }),
      prisma.fieldSchema.count({ where: { orgId } }),
      prisma.routingRule.count({ where: { orgId, status: "ACTIVE" } }),
    ]);

    const isHubSpot = org?.crmType === "HUBSPOT";
    const connected = isHubSpot ? org.hubspotPortalId != null : org?.sfdcOrgId != null;

    // HubSpot: 3 steps (no package deploy, fields auto-sync on connect)
    // Salesforce: 5 steps (deploy package + sync fields)
    const items = isHubSpot
      ? [
          { id: "connect", label: "Connect HubSpot", href: "/integrations", done: connected },
          { id: "license", label: "License Users", href: "/license-users", done: licenseCount > 0 },
          { id: "rule", label: "Create Routing Rule", href: "/routing-rules", done: activeRuleCount > 0 },
        ]
      : [
          { id: "connect", label: "Connect CRM", href: "/integrations", done: connected },
          { id: "deploy", label: "Deploy Package", href: "/integrations/salesforce", done: org?.packageDeployedAt != null },
          { id: "sync", label: "Sync Fields", href: "/integrations/salesforce", done: fieldCount > 0 },
          { id: "license", label: "License Users", href: "/license-users", done: licenseCount > 0 },
          { id: "rule", label: "Create Routing Rule", href: "/routing-rules", done: activeRuleCount > 0 },
        ];

    const completedCount = items.filter((i) => i.done).length;

    return NextResponse.json({ items, completedCount, total: items.length, orgId, crmType: org?.crmType ?? null });
  } catch (err) {
    console.error("GET /api/onboarding/status error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
