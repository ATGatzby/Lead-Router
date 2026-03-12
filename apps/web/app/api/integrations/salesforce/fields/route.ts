import { NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { createConnection, syncFieldSchema } from "@lead-routing/sfdc";

/**
 * POST /api/integrations/salesforce/fields
 *
 * Session-authenticated field sync for the Integrations UI.
 * Syncs Lead + Contact fields (+ Account if enabled in objectConfig),
 * then updates org.fieldsSyncedAt.
 */
export async function POST() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        sfdcOrgId: true,
        sfdcInstanceUrl: true,
        oauthAccessToken: true,
        oauthRefreshToken: true,
        objectConfig: true,
      },
    });

    if (!org || !org.sfdcOrgId) {
      return NextResponse.json({ error: "Salesforce not connected" }, { status: 400 });
    }
    if (!org.oauthAccessToken || !org.oauthRefreshToken || !org.sfdcInstanceUrl) {
      return NextResponse.json({ error: "Salesforce credentials missing" }, { status: 400 });
    }

    const conn = createConnection({
      accessToken: org.oauthAccessToken,
      refreshToken: org.oauthRefreshToken,
      instanceUrl: org.sfdcInstanceUrl,
    });

    // Determine which objects to sync
    const objectsToSync: Array<"Lead" | "Contact" | "Account"> = ["Lead", "Contact"];
    const config = org.objectConfig as Record<string, { enabled?: boolean }> | null;
    if (config?.Account?.enabled) {
      objectsToSync.push("Account");
    }

    const counts: Record<string, number> = {};
    for (const obj of objectsToSync) {
      counts[obj] = await syncFieldSchema(conn, orgId, obj);
    }

    // Update fieldsSyncedAt on the org
    await prisma.organization.update({
      where: { id: orgId },
      data: { fieldsSyncedAt: new Date() },
    });

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return NextResponse.json({ success: true, counts, total, syncedAt: new Date().toISOString() });
  } catch (err) {
    console.error("POST /api/integrations/salesforce/fields error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
