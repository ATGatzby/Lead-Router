import { NextResponse } from "next/server";
import { getSfdcAuthUrl, generatePkceVerifier, generatePkceChallenge } from "@lead-routing/sfdc";

// GET /api/auth/sfdc/login — redirect to Salesforce OAuth with PKCE
export async function GET() {
  const codeVerifier  = generatePkceVerifier();
  const codeChallenge = generatePkceChallenge(codeVerifier);

  const authUrl = getSfdcAuthUrl(codeChallenge);
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

  return response;
}
