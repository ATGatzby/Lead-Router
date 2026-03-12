import { NextResponse } from "next/server";
import crypto from "crypto";
import {
  MANAGED_PACKAGE_CLIENT_ID,
  OAUTH_REDIRECT_URL,
  generatePkceVerifier,
  generatePkceChallenge,
} from "@lead-routing/sfdc";

// GET /api/auth/sfdc/login — redirect to Salesforce OAuth with PKCE
export async function GET() {
  const codeVerifier  = generatePkceVerifier();
  const codeChallenge = generatePkceChallenge(codeVerifier);

  // Generate CSRF state parameter
  const originalState = crypto.randomBytes(16).toString("hex");

  // Build compound state for the central redirect service (oauth.leadrouting.com).
  // The redirect service decodes this, extracts targetUrl to know where to forward,
  // and passes originalState through so we can validate CSRF in the callback.
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const compoundState = Buffer.from(
    JSON.stringify({ targetUrl: appUrl, originalState })
  ).toString("base64url");

  const loginUrl = process.env.SFDC_LOGIN_URL ?? "https://login.salesforce.com";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: MANAGED_PACKAGE_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URL,
    scope: "api refresh_token",
    state: compoundState,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${loginUrl}/services/oauth2/authorize?${params.toString()}`;
  const response = NextResponse.redirect(authUrl);

  // Store verifier in a dedicated short-lived cookie on the redirect response.
  // Using iron-session.save() + NextResponse.redirect() doesn't reliably propagate
  // the Set-Cookie header in Next.js App Router — the browser never receives the
  // updated session, so the callback reads an empty sfdcCodeVerifier.
  response.cookies.set("sfdc_pkce_verifier", codeVerifier, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 minutes — enough for any OAuth round-trip
    path: "/",
  });

  // Store OAuth state in a dedicated cookie for CSRF validation in callback.
  // We store the original (non-compound) state so the callback can compare after
  // extracting originalState from the compound state returned by the redirect service.
  response.cookies.set("sfdc_oauth_state", originalState, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });

  return response;
}
