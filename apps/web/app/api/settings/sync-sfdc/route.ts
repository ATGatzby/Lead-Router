import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";
import { createConnection, pushSettings } from "@lead-routing/sfdc";

// POST /api/settings/sync-sfdc
// Pushes all org settings to Salesforce: webhook secret, engine URL, app URL,
// Named Credential endpoint, Remote Site Setting URL.
// Used by the manual "Sync to Salesforce" button in settings.
export async function POST() {
  try {
    const { orgId } = await getActorFromHeaders();

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        webhookSecret: true,
        oauthAccessToken: true,
        oauthRefreshToken: true,
        sfdcInstanceUrl: true,
      },
    });

    if (!org.oauthAccessToken || !org.oauthRefreshToken || !org.sfdcInstanceUrl) {
      return NextResponse.json(
        { error: "Salesforce org not connected" },
        { status: 400 }
      );
    }

    const conn = createConnection({
      accessToken: org.oauthAccessToken,
      refreshToken: org.oauthRefreshToken,
      instanceUrl: org.sfdcInstanceUrl,
    });

    await pushSettings(conn, {
      webhookSecret: org.webhookSecret,
      engineUrl: process.env.PUBLIC_ENGINE_URL ?? process.env.ENGINE_URL ?? "http://localhost:3001",
      appUrl: process.env.APP_URL ?? "http://localhost:3000",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/settings/sync-sfdc error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
