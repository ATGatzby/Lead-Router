import { NextResponse } from "next/server";
import { getSfdcAuthUrl, generatePkceVerifier, generatePkceChallenge } from "@lead-routing/sfdc";
import { getSession } from "@/lib/session";

// GET /api/auth/sfdc/login — redirect to Salesforce OAuth with PKCE
export async function GET() {
  const codeVerifier  = generatePkceVerifier();
  const codeChallenge = generatePkceChallenge(codeVerifier);

  // Persist verifier in session so the callback can complete the exchange
  const session = await getSession();
  session.sfdcCodeVerifier = codeVerifier;
  await session.save();

  const authUrl = getSfdcAuthUrl(codeChallenge);
  return NextResponse.redirect(authUrl);
}
