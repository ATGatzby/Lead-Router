import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import crypto from "node:crypto";
import { LeadRoutingClientsStore } from "./clients-store.js";

interface StoredAuthCode {
  orgId: string;
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
}

/**
 * OAuth 2.1 provider for the Lead Routing MCP server.
 *
 * Flow:
 *  1. authorize() — redirects the user to the web app's /api/mcp-auth/authorize
 *     endpoint, which handles login (if needed) and issues an auth code.
 *  2. exchangeAuthorizationCode() — POSTs to the web app's /api/mcp-auth/token
 *     endpoint, which verifies PKCE and returns an API token (lr_*).
 *  3. verifyAccessToken() — validates the lr_* token against the web app.
 *
 * We set skipLocalPkceValidation = true because the web app's token endpoint
 * performs the PKCE verification itself.
 */
export class LeadRoutingOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: LeadRoutingClientsStore;
  readonly skipLocalPkceValidation = true;

  private appUrl: string;

  constructor(appUrl: string) {
    this.appUrl = appUrl.replace(/\/$/, "");
    this.clientsStore = new LeadRoutingClientsStore();
  }

  /**
   * Redirect the user to the web app to authenticate.
   * The web app checks their session (or shows login), then redirects back
   * with an authorization code.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const url = new URL(`${this.appUrl}/api/mcp-auth/authorize`);
    url.searchParams.set("client_id", client.client_id);
    url.searchParams.set("redirect_uri", params.redirectUri);
    url.searchParams.set("code_challenge", params.codeChallenge);
    if (params.state) {
      url.searchParams.set("state", params.state);
    }
    if (params.scopes?.length) {
      url.searchParams.set("scope", params.scopes.join(" "));
    }

    console.log(`[OAuth] Redirecting to web app authorize for client=${client.client_id.slice(0, 8)}...`);
    res.redirect(url.toString());
  }

  /**
   * Not used when skipLocalPkceValidation is true, but required by interface.
   * The web app stores and verifies the code_challenge itself.
   */
  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    _authorizationCode: string,
  ): Promise<string> {
    // PKCE validation is handled by the web app's token endpoint.
    // This method won't be called when skipLocalPkceValidation = true,
    // but we return an empty string to satisfy the interface.
    return "";
  }

  /**
   * Exchange the authorization code for an access token by delegating
   * to the web app's /api/mcp-auth/token endpoint.
   */
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    redirectUri?: string,
  ): Promise<OAuthTokens> {
    console.log(`[OAuth] Exchanging auth code for token (client=${client.client_id})`);

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: authorizationCode,
      client_id: client.client_id,
    });
    if (codeVerifier) body.set("code_verifier", codeVerifier);
    if (redirectUri) body.set("redirect_uri", redirectUri);

    const res = await fetch(`${this.appUrl}/api/mcp-auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "unknown" }));
      console.error(`[OAuth] Token exchange failed (${res.status}):`, err);
      throw new Error(`Token exchange failed: ${err.error_description || err.error}`);
    }

    const tokens = await res.json();
    console.log(`[OAuth] Token exchange succeeded`);

    return {
      access_token: tokens.access_token,
      token_type: tokens.token_type || "bearer",
      expires_in: tokens.expires_in,
      scope: tokens.scope,
      refresh_token: tokens.refresh_token,
    };
  }

  /**
   * Refresh tokens are not supported — the lr_* API tokens don't expire
   * (unless manually revoked or the optional expiresAt is set).
   */
  async exchangeRefreshToken(): Promise<OAuthTokens> {
    throw new Error("Refresh tokens are not supported");
  }

  /**
   * Verify an access token by checking it against the web app.
   * The token is an lr_* API token — we validate it by calling the web app's
   * token-info endpoint.
   */
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!token.startsWith("lr_")) {
      throw new Error("Invalid token format");
    }

    const res = await fetch(`${this.appUrl}/api/token-info`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error("Invalid or expired token");
    }

    const info = await res.json();

    return {
      token,
      clientId: info.clientId || "unknown",
      scopes: info.scopes || ["read", "route"],
      expiresAt: info.expiresAt
        ? Math.floor(new Date(info.expiresAt).getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 86400,
    };
  }

  /**
   * Revoke a token by calling the web app.
   */
  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    console.log(`[OAuth] Revoking token`);

    // Best-effort revocation — if the token is already invalid, that's fine
    try {
      const tokenHash = crypto.createHash("sha256").update(request.token).digest("hex");
      await fetch(`${this.appUrl}/api/tokens/revoke`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tokenHash }),
      });
    } catch (err) {
      console.error(`[OAuth] Token revocation failed:`, err);
    }
  }
}
