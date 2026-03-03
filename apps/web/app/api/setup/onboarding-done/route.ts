import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { createConnection, pushSettings } from "@lead-routing/sfdc";

// POST /api/setup/onboarding-done
// Called by OnboardingController.markOnboardingDone() after Step 4 completes.
// Identified by X-Sfdc-Org-Id header (set by Apex callout).
export async function POST(req: NextRequest) {
  try {
    const sfdcOrgId = req.headers.get("x-sfdc-org-id");

    if (!sfdcOrgId) {
      return NextResponse.json({ error: "Missing X-Sfdc-Org-Id header" }, { status: 400 });
    }

    const org = await prisma.organization.findUnique({
      where: { sfdcOrgId },
      select: { id: true },
    });

    if (!org) {
      return NextResponse.json({ error: "Org not found" }, { status: 404 });
    }

    const updated = await prisma.organization.update({
      where: { id: org.id },
      data: { onboardingDone: true },
      select: {
        webhookSecret: true,
        oauthAccessToken: true,
        oauthRefreshToken: true,
        sfdcInstanceUrl: true,
      },
    });

    // Push all settings to SFDC now that onboarding is complete.
    // Fire-and-forget — don't block the response on failure.
    if (updated.oauthAccessToken && updated.oauthRefreshToken && updated.sfdcInstanceUrl) {
      const conn = createConnection({
        accessToken: updated.oauthAccessToken,
        refreshToken: updated.oauthRefreshToken,
        instanceUrl: updated.sfdcInstanceUrl,
      });
      pushSettings(conn, {
        webhookSecret: updated.webhookSecret,
        engineUrl: process.env.PUBLIC_ENGINE_URL ?? process.env.ENGINE_URL ?? "http://localhost:3001",
        appUrl: process.env.APP_URL ?? "http://localhost:3000",
      }).catch((err) =>
        console.error("[onboarding-done] pushSettings failed:", err)
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/setup/onboarding-done error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
