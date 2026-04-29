import { randomBytes, createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createCliAuthSession } from "@/lib/cli-auth-store";
import { resolveBearerOrgId } from "@/lib/bearer-auth";
import { MANAGED_PACKAGE_CLIENT_ID, OAUTH_REDIRECT_URL } from "@lead-routing/sfdc";

// POST /api/cli-auth/request
// Called by the CLI before opening the Salesforce browser auth flow.
// Returns a sessionId and the Salesforce OAuth URL the CLI should open.
// Uses PKCE (S256) so the Connected App's "Require Secret for Web Server Flow"
// setting is satisfied without needing a client secret in the browser redirect.
//
// Optional Bearer auth: if the CLI sends `Authorization: Bearer lr_...`, we
// resolve the orgId and bind it to the session so the OAuth callback can
// persist tokens to the correct Organization in the DB. Without this, tokens
// only land in the in-memory cli-auth-store and never reach the database,
// breaking subsequent /api/fields/sync and /api/setup/* calls.
export async function POST(req: NextRequest) {
  const sessionId = randomBytes(16).toString("hex");

  // PKCE: generate verifier + challenge
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");

  // Try to resolve org from Bearer token (optional — backward compat with old CLI)
  let orgId: string | undefined;
  try {
    const authHeader = req.headers.get('authorization');
    orgId = (await resolveBearerOrgId(authHeader)) ?? undefined;
  } catch {
    // No Bearer token or invalid — proceed without orgId (legacy flow)
  }
  console.log(`[cli-auth] REQUEST_REACHED_v3 sessionId=${sessionId} orgId=${orgId ?? 'null'} hasBearer=${!!req.headers.get('authorization')}`);

  createCliAuthSession(sessionId, codeVerifier, orgId);

  const loginUrl =
    process.env.SFDC_LOGIN_URL ?? "https://login.salesforce.com";
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";

  // Build compound state for the central redirect service.
  // The redirect service decodes this, extracts targetUrl to know where to forward,
  // and passes originalState through to the callback.
  const compoundState = Buffer.from(
    JSON.stringify({ targetUrl: appUrl, originalState: `cli:${sessionId}` })
  ).toString("base64url");

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
  return Response.json({ sessionId, authUrl });
}
