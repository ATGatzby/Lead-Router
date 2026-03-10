import { randomBytes, createHash } from "node:crypto";
import jsforce from "jsforce";
import type { Connection } from "jsforce";
const { Connection: ConnectionClass } = jsforce;

export type SfdcConnection = Connection;

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
}

const getOAuth2Config = () => ({
  loginUrl: process.env.SFDC_LOGIN_URL ?? "https://login.salesforce.com",
  clientId: process.env.SFDC_CLIENT_ID!,
  clientSecret: process.env.SFDC_CLIENT_SECRET!,
  redirectUri: process.env.SFDC_REDIRECT_URI!,
});

/** Generate a PKCE code_verifier (random URL-safe base64, 43 chars). */
export function generatePkceVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** Derive the PKCE code_challenge from a verifier (SHA-256, base64url). */
export function generatePkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Build the Salesforce OAuth authorization URL.
 * Pass codeChallenge (from generatePkceChallenge) when PKCE is required.
 */
export function getSfdcAuthUrl(codeChallenge?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.SFDC_CLIENT_ID!,
    redirect_uri: process.env.SFDC_REDIRECT_URI!,
    scope: "api refresh_token",
  });
  if (codeChallenge) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  const loginUrl = process.env.SFDC_LOGIN_URL ?? "https://login.salesforce.com";
  return `${loginUrl}/services/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange an OAuth authorization code for access + refresh tokens.
 * Pass codeVerifier when the auth URL was built with a PKCE challenge.
 */
export async function exchangeCodeForTokens(
  code: string,
  codeVerifier?: string
): Promise<{
  tokens: OAuthTokens;
  orgId: string;
  userId: string;
  userName: string;
  userEmail: string;
}> {
  const loginUrl = process.env.SFDC_LOGIN_URL ?? "https://login.salesforce.com";

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: process.env.SFDC_CLIENT_ID!,
    client_secret: process.env.SFDC_CLIENT_SECRET!,
    redirect_uri: process.env.SFDC_REDIRECT_URI!,
  });
  if (codeVerifier) body.set("code_verifier", codeVerifier);

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Salesforce token exchange failed: ${err}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    instance_url: string;
    id: string; // identity URL
  };

  const idRes = await fetch(data.id, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  if (!idRes.ok) throw new Error("Failed to fetch Salesforce identity");
  const identity = await idRes.json() as {
    organization_id: string;
    user_id: string;
    display_name: string;
    email: string;
  };

  return {
    tokens: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      instanceUrl: data.instance_url,
    },
    orgId: identity.organization_id,
    userId: identity.user_id,
    userName: identity.display_name,
    userEmail: identity.email,
  };
}

/**
 * Callback invoked when jsforce auto-refreshes the access token.
 * Consumers (engine, web) can use this to persist the new token to the DB.
 */
export type OnTokenRefresh = (accessToken: string, res: unknown) => void;

/**
 * Create a jsforce connection from stored tokens.
 * Handles token refresh automatically.
 *
 * Pass `onTokenRefresh` to be notified when jsforce obtains a fresh access
 * token — use this to persist the new token back to the database so it
 * survives process restarts.
 */
export function createConnection(
  tokens: OAuthTokens,
  onTokenRefresh?: OnTokenRefresh
): Connection {
  const conn = new ConnectionClass({
    oauth2: getOAuth2Config(),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    instanceUrl: tokens.instanceUrl,
  });

  if (onTokenRefresh) {
    conn.on("refresh", onTokenRefresh);
  }

  return conn;
}

/**
 * Refresh an access token using the stored refresh token.
 * Returns the new access token.
 */
export async function refreshAccessToken(tokens: OAuthTokens): Promise<string> {
  const conn = createConnection(tokens);
  await (conn as any).oauth2.refreshToken(tokens.refreshToken);
  return conn.accessToken!;
}
