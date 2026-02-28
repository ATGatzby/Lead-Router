import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens, createConnection, pushSettings } from "@lead-routing/sfdc";
import { prisma } from "@lead-routing/db";
import { getSession } from "@/lib/session";

// GET /api/auth/sfdc/callback — called by Salesforce after OAuth consent
// Associates the SFDC org with the already-logged-in user's org
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  // Use APP_URL for all redirects — req.url inside Docker uses the container's
  // internal hostname which the browser cannot reach.
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  if (error || !code) {
    const desc = searchParams.get("error_description") ?? "OAuth failed";
    return NextResponse.redirect(
      new URL(`/dashboard?crm_error=${encodeURIComponent(desc)}`, appUrl)
    );
  }

  try {
    // Use getSession() (returns IronSession) so we can call .save() to clear the verifier
    const session = await getSession();
    if (!session.orgId) throw new Error("Not authenticated");

    // Retrieve and clear the PKCE verifier stored during /api/auth/sfdc/login
    const codeVerifier = session.sfdcCodeVerifier;
    if (codeVerifier) {
      session.sfdcCodeVerifier = undefined;
      await session.save();
    }

    const { tokens, orgId: sfdcOrgId } = await exchangeCodeForTokens(code, codeVerifier);

    // Check this SFDC org isn't already connected to a different account
    const conflict = await prisma.organization.findUnique({
      where: { sfdcOrgId },
      select: { id: true },
    });
    if (conflict && conflict.id !== session.orgId) {
      return NextResponse.redirect(
        new URL("/dashboard?crm_error=This+Salesforce+org+is+already+connected+to+another+account", appUrl)
      );
    }

    const org = await prisma.organization.update({
      where: { id: session.orgId },
      data: {
        sfdcOrgId,
        sfdcInstanceUrl: tokens.instanceUrl,
        oauthAccessToken: tokens.accessToken,
        oauthRefreshToken: tokens.refreshToken,
      },
      select: { webhookSecret: true },
    });

    // Push settings to SFDC so Routing_Settings__c + Named Credential + Remote Site Setting stay in sync.
    // Fire-and-forget — don't block the redirect on failure.
    if (org.webhookSecret) {
      const conn = createConnection(tokens);
      pushSettings(conn, {
        webhookSecret: org.webhookSecret,
        engineUrl: process.env.ENGINE_URL ?? "http://localhost:3001",
        appUrl: process.env.APP_URL ?? "http://localhost:3000",
      }).catch((err) =>
        console.error("[sfdc-callback] pushSettings failed:", err)
      );
    }

    return NextResponse.redirect(new URL("/dashboard?crm_connected=1", appUrl));
  } catch (err) {
    console.error("SFDC OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard?crm_error=Connection+failed", appUrl)
    );
  }
}
