import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";
import { createConnection, syncQueues } from "@lead-routing/sfdc";

// POST /api/queues/sync — trigger SFDC queue sync
export async function POST() {
  try {
    const { orgId } = await getActorFromHeaders();

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { oauthAccessToken: true, oauthRefreshToken: true, sfdcInstanceUrl: true },
    });

    if (!org.oauthAccessToken || !org.oauthRefreshToken || !org.sfdcInstanceUrl) {
      return NextResponse.json({ error: "Salesforce org not connected" }, { status: 400 });
    }

    const conn = createConnection({
      accessToken: org.oauthAccessToken,
      refreshToken: org.oauthRefreshToken,
      instanceUrl: org.sfdcInstanceUrl,
    });

    const count = await syncQueues(conn, orgId);

    return NextResponse.json({ synced: count, syncedAt: new Date() });
  } catch (err) {
    console.error("POST /api/queues/sync error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
