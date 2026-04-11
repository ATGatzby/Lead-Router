import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getAuthorizationUrl } from "@lead-routing/hubspot";

// Default scopes required for Lead Routing HubSpot integration
const HUBSPOT_SCOPES = [
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
  "crm.objects.owners.read",
  "crm.schemas.contacts.read",
  "crm.schemas.companies.read",
  "crm.schemas.deals.read",
  "oauth",
];

// GET /api/auth/hubspot/login — redirect to HubSpot OAuth consent screen
export async function GET() {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "HUBSPOT_CLIENT_ID is not configured" },
      { status: 500 }
    );
  }

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const redirectUri =
    process.env.HUBSPOT_REDIRECT_URI ?? `${appUrl}/api/auth/hubspot/callback`;

  // Generate CSRF state parameter
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = getAuthorizationUrl(clientId, redirectUri, HUBSPOT_SCOPES, state);

  const response = NextResponse.redirect(authUrl);

  // Store state in a short-lived cookie for CSRF validation in callback
  response.cookies.set("hubspot_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes
    path: "/",
  });

  return response;
}
