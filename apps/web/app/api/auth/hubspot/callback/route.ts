import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForTokens,
  getTokenInfo,
} from "@lead-routing/hubspot";
import { prisma } from "@lead-routing/db";
import { getSession } from "@/lib/session";

// GET /api/auth/hubspot/callback — called by HubSpot after OAuth consent
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const state = searchParams.get("state");

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  if (error || !code) {
    const desc = searchParams.get("error_description") ?? "OAuth failed";
    return NextResponse.redirect(
      new URL(`/dashboard?crm_error=${encodeURIComponent(desc)}`, appUrl)
    );
  }

  try {
    const session = await getSession();
    if (!session.orgId) throw new Error("Not authenticated");

    // Validate OAuth state parameter (CSRF protection)
    const savedState = req.cookies.get("hubspot_oauth_state")?.value;
    if (!state || !savedState || state !== savedState) {
      return NextResponse.json({ error: "Invalid OAuth state" }, { status: 403 });
    }

    const clientId = process.env.HUBSPOT_CLIENT_ID;
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("HUBSPOT_CLIENT_ID or HUBSPOT_CLIENT_SECRET not configured");
    }

    const redirectUri =
      process.env.HUBSPOT_REDIRECT_URI ?? `${appUrl}/api/auth/hubspot/callback`;

    // Exchange authorization code for tokens
    const tokens = await exchangeCodeForTokens(clientId, clientSecret, redirectUri, code);

    // Get token metadata to extract portal (hub) ID and app ID
    const tokenInfo = await getTokenInfo(tokens.access_token);
    const portalId = String(tokenInfo.hub_id);
    const appId = String(tokenInfo.app_id);

    // Check this HubSpot portal isn't already connected to a different account
    const conflict = await prisma.organization.findUnique({
      where: { hubspotPortalId: portalId },
      select: { id: true },
    });
    if (conflict && conflict.id !== session.orgId) {
      return NextResponse.redirect(
        new URL(
          "/dashboard?crm_error=This+HubSpot+portal+is+already+connected+to+another+account",
          appUrl
        )
      );
    }

    // Update organization with HubSpot connection details
    await prisma.organization.update({
      where: { id: session.orgId },
      data: {
        crmType: "HUBSPOT",
        hubspotPortalId: portalId,
        hubspotAppId: appId,
        oauthAccessToken: tokens.access_token,
        oauthRefreshToken: tokens.refresh_token,
      },
    });

    const successRedirect = NextResponse.redirect(
      new URL("/integrations?connected=hubspot", appUrl)
    );
    successRedirect.cookies.delete("hubspot_oauth_state");
    return successRedirect;
  } catch (err) {
    console.error("HubSpot OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/dashboard?crm_error=HubSpot+connection+failed", appUrl)
    );
  }
}
