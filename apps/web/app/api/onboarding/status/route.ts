import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/onboarding/status
// Returns checklist items for the sidebar onboarding widget.
export async function GET(_req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();

    const [org, licenseCount, teamCount, activeRuleCount] = await Promise.all([
      prisma.organization.findUnique({ where: { id: orgId }, select: { sfdcOrgId: true } }),
      prisma.user.count({ where: { orgId, isLicensed: true } }),
      prisma.roundRobinTeam.count({ where: { orgId } }),
      prisma.routingRule.count({ where: { orgId, status: "ACTIVE" } }),
    ]);

    const items = [
      {
        id: "connect",
        label: "Connect Salesforce org",
        done: org?.sfdcOrgId != null,
      },
      {
        id: "license",
        label: "License at least one user",
        done: licenseCount > 0,
      },
      {
        id: "team",
        label: "Create a round-robin team",
        done: teamCount > 0,
      },
      {
        id: "rule",
        label: "Create an active routing rule",
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
