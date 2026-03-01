import { randomBytes, createHash } from "node:crypto";
import { createCliAuthSession } from "@/lib/cli-auth-store";

// POST /api/cli-auth/request
// Called by the CLI before opening the Salesforce browser auth flow.
// Returns a sessionId and the Salesforce OAuth URL the CLI should open.
// Uses PKCE (S256) so the Connected App's "Require Secret for Web Server Flow"
// setting is satisfied without needing a client secret in the browser redirect.
export async function POST() {
  const sessionId = randomBytes(16).toString("hex");

  // PKCE: generate verifier + challenge
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  createCliAuthSession(sessionId, codeVerifier);

  const loginUrl =
    process.env.SFDC_LOGIN_URL ?? "https://login.salesforce.com";
  const clientId = process.env.SFDC_CLIENT_ID ?? "";
  const redirectUri = process.env.SFDC_REDIRECT_URI ?? "";

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "api refresh_token",
    state: `cli:${sessionId}`,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  const authUrl = `${loginUrl}/services/oauth2/authorize?${params.toString()}`;
  return Response.json({ sessionId, authUrl });
}
