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
        select: { sfdcOrgId: true, packageDeployedAt: true },
      }),
      prisma.user.count({ where: { orgId, isLicensed: true } }),
      prisma.fieldSchema.count({ where: { orgId } }),
      prisma.routingRule.count({ where: { orgId, status: "ACTIVE" } }),
    ]);

    const items = [
      {
        id: "connect",
        label: "Connect CRM",
        href: "/integrations",
        done: org?.sfdcOrgId != null,
      },
      {
        id: "deploy",
        label: "Deploy Package",
        href: "/integrations/salesforce",
        done: org?.packageDeployedAt != null,
      },
      {
        id: "sync",
        label: "Sync Fields",
        href: "/integrations/salesforce",
        done: fieldCount > 0,
      },
      {
        id: "license",
        label: "License Users",
        href: "/license-users",
        done: licenseCount > 0,
      },
      {
        id: "rule",
        label: "Create Routing Rule",
        href: "/routing-rules",
        done: activeRuleCount > 0,
      },
    ];

    const completedCount = items.filter((i) => i.done).length;

    return NextResponse.json({ items, completedCount, total: items.length, orgId });
  } catch (err) {
    console.error("GET /api/onboarding/status error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
