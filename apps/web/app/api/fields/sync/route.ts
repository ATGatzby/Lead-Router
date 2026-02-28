import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@lead-routing/db";
import { createConnection, syncFieldSchema } from "@lead-routing/sfdc";

// POST /api/fields/sync?object=LEAD — trigger SFDC describeSObject sync
// Called by the LWC onboarding wizard (Apex HTTP callout) using X-Sfdc-Org-Id,
// so we look up the org by sfdcOrgId rather than requiring an iron-session cookie.
export async function POST(req: NextRequest) {
  try {
    const hdrs = await headers();
    const sfdcOrgId = hdrs.get("x-sfdc-org-id");
    if (!sfdcOrgId) {
      return NextResponse.json({ error: "Missing X-Sfdc-Org-Id header" }, { status: 401 });
    }

    const org = await prisma.organization.findUnique({
      where: { sfdcOrgId },
      select: { id: true, oauthAccessToken: true, oauthRefreshToken: true, sfdcInstanceUrl: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Org not found" }, { status: 404 });
    }
    const orgId = org.id;

    const objectParam = req.nextUrl.searchParams.get("object")?.toUpperCase() ?? "LEAD";

    if (!["LEAD", "CONTACT", "ACCOUNT"].includes(objectParam)) {
      return NextResponse.json({ error: "Invalid object type" }, { status: 400 });
    }

    const objectType = (objectParam.charAt(0) + objectParam.slice(1).toLowerCase()) as
      | "Lead"
      | "Contact"
      | "Account";

    if (!org.oauthAccessToken || !org.oauthRefreshToken || !org.sfdcInstanceUrl) {
      return NextResponse.json({ error: "Salesforce org not connected" }, { status: 400 });
    }

    const conn = createConnection({
      accessToken: org.oauthAccessToken,
      refreshToken: org.oauthRefreshToken,
      instanceUrl: org.sfdcInstanceUrl,
    });

    const count = await syncFieldSchema(conn, orgId, objectType);

    return NextResponse.json({ synced: count, objectType: objectParam, syncedAt: new Date() });
  } catch (err) {
    console.error("POST /api/fields/sync error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
