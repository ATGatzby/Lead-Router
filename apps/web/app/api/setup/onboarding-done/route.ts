import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { createConnection, pushSettings } from "@lead-routing/sfdc";
import { validateSfdcHmac } from "@/lib/validate-sfdc-hmac";
import { resolveBearerOrgId } from "@/lib/bearer-auth";

// POST /api/setup/onboarding-done
//
// Marks an organisation's onboarding as complete and re-pushes Routing_Settings
// to Salesforce. Two callers:
//
//   1. Apex (OnboardingController.markOnboardingDone) — sends X-Sfdc-Org-Id
//      header (and optionally X-Signature-256 for HMAC validation).
//   2. CLI (lead-routing init) — sends Authorization: Bearer lr_<token>. This
//      route lives under PUBLIC_PREFIXES, so we resolve the token directly
//      here rather than relying on proxy-injected `x-org-id`.
export async function POST(req: NextRequest) {
  try {
    const sfdcOrgId = req.headers.get("x-sfdc-org-id");
    const authHeader = req.headers.get("authorization");
    const bearerOrgId = await resolveBearerOrgId(authHeader);

    if (!sfdcOrgId && !bearerOrgId) {
      return NextResponse.json(
        { error: "Missing X-Sfdc-Org-Id header or Bearer token" },
        { status: 400 }
      );
    }

    // Read body once so HMAC can validate the raw payload.
    const body = await req.text();

    let org: { id: string } | null = null;

    if (sfdcOrgId) {
      // HMAC validation only applies to the Apex callout flow.
      const signature = req.headers.get("x-signature-256");
      if (signature) {
        const valid = await validateSfdcHmac(sfdcOrgId, body, signature);
        if (!valid) {
          return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
        }
      }

      org = await prisma.organization.findUnique({
        where: { sfdcOrgId },
        select: { id: true },
      });
    } else if (bearerOrgId) {
      org = await prisma.organization.findUnique({
        where: { id: bearerOrgId },
        select: { id: true },
      });
    }

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

    console.log(
      `[onboarding-done] orgId=${org.id} marked complete via=${sfdcOrgId ? "apex" : "bearer"}`
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/setup/onboarding-done error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
