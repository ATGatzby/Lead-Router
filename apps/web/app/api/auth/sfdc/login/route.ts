import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSfdcAuthUrl, generatePkceVerifier, generatePkceChallenge } from "@lead-routing/sfdc";

// GET /api/auth/sfdc/login — redirect to Salesforce OAuth with PKCE
export async function GET() {
  const codeVerifier  = generatePkceVerifier();
  const codeChallenge = generatePkceChallenge(codeVerifier);

  // Generate CSRF state parameter
  const state = crypto.randomBytes(16).toString("hex");

  const authUrl = getSfdcAuthUrl(codeChallenge) + `&state=${state}`;
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

  // Store OAuth state in a dedicated cookie for CSRF validation in callback
  response.cookies.set("sfdc_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });

  return response;
}
