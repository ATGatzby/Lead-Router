import { randomBytes } from "node:crypto";
import { createCliAuthSession } from "@/lib/cli-auth-store";

// POST /api/cli-auth/request
// Called by the CLI before opening the Salesforce browser auth flow.
// Returns a sessionId and the Salesforce OAuth URL the CLI should open.
// The URL uses redirect_uri={appUrl}/api/auth/callback (already registered in the
// Connected App) so no additional callback URLs need to be added.
export async function POST() {
  const sessionId = randomBytes(16).toString("hex");
  createCliAuthSession(sessionId);

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
  });

  const authUrl = `${loginUrl}/services/oauth2/authorize?${params.toString()}`;
  return Response.json({ sessionId, authUrl });
}
