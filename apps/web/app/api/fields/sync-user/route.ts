import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { createConnection, syncFieldSchema } from "@lead-routing/sfdc";
import { getOrgIdFromHeaders } from "@/lib/auth";

// POST /api/fields/sync-user — sync User object fields from Salesforce (session auth)
export async function POST() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { oauthAccessToken: true, oauthRefreshToken: true, sfdcInstanceUrl: true },
    });

    if (!org?.oauthAccessToken || !org.oauthRefreshToken || !org.sfdcInstanceUrl) {
      return NextResponse.json({ error: "Salesforce org not connected" }, { status: 400 });
    }

    const conn = createConnection({
      accessToken: org.oauthAccessToken,
      refreshToken: org.oauthRefreshToken,
      instanceUrl: org.sfdcInstanceUrl,
    });

    const synced = await syncFieldSchema(conn, orgId, "User");
    return NextResponse.json({ synced });
  } catch (err) {
    console.error("POST /api/fields/sync-user error:", err);
    return NextResponse.json({ error: "Failed to sync User fields" }, { status: 500 });
  }
}
