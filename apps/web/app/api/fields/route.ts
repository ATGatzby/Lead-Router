import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/fields?object=LEAD — list field schemas for the given object type
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const objectParam = req.nextUrl.searchParams.get("object")?.toUpperCase() ?? req.nextUrl.searchParams.get("objectType")?.toUpperCase() ?? "LEAD";
    const customOnly = req.nextUrl.searchParams.get("customOnly") === "true";

    if (!["LEAD", "CONTACT", "ACCOUNT", "USER", "COMPANY", "DEAL"].includes(objectParam)) {
      return NextResponse.json({ error: "Invalid object type" }, { status: 400 });
    }

    // Auto-map Salesforce ↔ HubSpot object types based on org's CRM type
    let resolvedObjectType = objectParam;
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { crmType: true } });
    if (org?.crmType === "HUBSPOT") {
      if (objectParam === "ACCOUNT") resolvedObjectType = "COMPANY";
      if (objectParam === "LEAD") resolvedObjectType = "CONTACT";
    } else {
      if (objectParam === "COMPANY") resolvedObjectType = "ACCOUNT";
      if (objectParam === "DEAL") resolvedObjectType = "LEAD";
    }

    const where: Record<string, unknown> = { orgId };
    where.objectType = resolvedObjectType;

    if (customOnly) {
      where.fieldApiName = { endsWith: "__c" };
    }

    const fields = await prisma.fieldSchema.findMany({
      where,
      orderBy: { fieldLabel: "asc" },
      select: {
        id: true,
        fieldApiName: true,
        fieldLabel: true,
        fieldType: true,
        picklistValues: true,
        syncedAt: true,
      },
    });

    return NextResponse.json({ fields });
  } catch (err) {
    console.error("GET /api/fields error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
