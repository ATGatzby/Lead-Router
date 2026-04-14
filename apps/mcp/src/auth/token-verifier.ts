import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/**
 * Validates `lr_` API tokens against the web app's /api/token-info endpoint.
 * Implements the SDK's OAuthTokenVerifier so it can be used with requireBearerAuth.
 */
export class TokenVerifier implements OAuthTokenVerifier {
  private cache = new Map<string, { info: AuthInfo; expiresAt: number }>();
  private appUrl: string;

  constructor(appUrl: string) {
    this.appUrl = appUrl;
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    // Check cache first (60s TTL)
    const cached = this.cache.get(token);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.info;
    }

    // Validate against web app
    const res = await fetch(`${this.appUrl}/api/token-info`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error("Invalid or expired token");
    }

    const data = (await res.json()) as {
      tokenId?: string;
      scopes?: string[];
    };

    const info: AuthInfo = {
      token,
      clientId: data.tokenId ?? "unknown",
      scopes: data.scopes ?? ["read"],
      // SDK requires expiresAt as a number (seconds since epoch).
      // Use the token's actual expiry, or 24h from now for non-expiring tokens.
      expiresAt: data.expiresAt
        ? Math.floor(new Date(data.expiresAt).getTime() / 1000)
        : Math.floor(Date.now() / 1000) + 86400,
    };

    // Cache for 60 seconds
    this.cache.set(token, { info, expiresAt: Date.now() + 60_000 });
    return info;
  }
}
