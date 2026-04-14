import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LeadRoutingOAuthProvider } from "../auth/oauth-provider.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";

const APP_URL = "https://app.example.com";

function makeClient(overrides: Partial<OAuthClientInformationFull> = {}): OAuthClientInformationFull {
  return {
    client_id: "test-client-id",
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: ["https://callback.example.com/oauth"],
    ...overrides,
  } as OAuthClientInformationFull;
}

function makeRes() {
  return {
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as any;
}

describe("LeadRoutingOAuthProvider", () => {
  let provider: LeadRoutingOAuthProvider;
  const originalFetch = global.fetch;

  beforeEach(() => {
    provider = new LeadRoutingOAuthProvider(APP_URL);
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // ---------------------------------------------------------------
  // authorize()
  // ---------------------------------------------------------------
  describe("authorize()", () => {
    it("redirects with correct URL containing client_id, redirect_uri, and code_challenge", async () => {
      const client = makeClient();
      const params: AuthorizationParams = {
        redirectUri: "https://callback.example.com/oauth",
        codeChallenge: "abc123challenge",
        state: "some-state",
        scopes: ["read", "route"],
      };
      const res = makeRes();

      await provider.authorize(client, params, res);

      expect(res.redirect).toHaveBeenCalledTimes(1);

      const redirectUrl = new URL(res.redirect.mock.calls[0][0]);
      expect(redirectUrl.origin).toBe(APP_URL);
      expect(redirectUrl.pathname).toBe("/api/mcp-auth/authorize");
      expect(redirectUrl.searchParams.get("client_id")).toBe("test-client-id");
      expect(redirectUrl.searchParams.get("redirect_uri")).toBe("https://callback.example.com/oauth");
      expect(redirectUrl.searchParams.get("code_challenge")).toBe("abc123challenge");
      expect(redirectUrl.searchParams.get("state")).toBe("some-state");
      expect(redirectUrl.searchParams.get("scope")).toBe("read route");
    });

    it("omits state and scope when not provided", async () => {
      const client = makeClient();
      const params: AuthorizationParams = {
        redirectUri: "https://callback.example.com/oauth",
        codeChallenge: "challenge",
      };
      const res = makeRes();

      await provider.authorize(client, params, res);

      const redirectUrl = new URL(res.redirect.mock.calls[0][0]);
      expect(redirectUrl.searchParams.has("state")).toBe(false);
      expect(redirectUrl.searchParams.has("scope")).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // exchangeAuthorizationCode()
  // ---------------------------------------------------------------
  describe("exchangeAuthorizationCode()", () => {
    it("POSTs to /api/mcp-auth/token and returns OAuthTokens", async () => {
      const tokenResponse = {
        access_token: "lr_abc123",
        token_type: "bearer",
        expires_in: 31536000,
        scope: "read route agent",
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => tokenResponse,
      });

      const client = makeClient();
      const tokens = await provider.exchangeAuthorizationCode(
        client,
        "auth-code-xyz",
        "verifier123",
        "https://callback.example.com/oauth",
      );

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`${APP_URL}/api/mcp-auth/token`);
      expect(opts.method).toBe("POST");
      expect(opts.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

      const body = new URLSearchParams(opts.body);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("auth-code-xyz");
      expect(body.get("client_id")).toBe("test-client-id");
      expect(body.get("code_verifier")).toBe("verifier123");
      expect(body.get("redirect_uri")).toBe("https://callback.example.com/oauth");

      expect(tokens).toEqual({
        access_token: "lr_abc123",
        token_type: "bearer",
        expires_in: 31536000,
        scope: "read route agent",
        refresh_token: undefined,
      });
    });

    it("throws on non-200 response", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: "invalid_grant",
          error_description: "Authorization code expired",
        }),
      });

      const client = makeClient();

      await expect(
        provider.exchangeAuthorizationCode(client, "bad-code"),
      ).rejects.toThrow("Token exchange failed: Authorization code expired");
    });

    it("throws with error field when error_description is missing", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: "server_error" }),
      });

      const client = makeClient();

      await expect(
        provider.exchangeAuthorizationCode(client, "bad-code"),
      ).rejects.toThrow("Token exchange failed: server_error");
    });
  });

  // ---------------------------------------------------------------
  // verifyAccessToken()
  // ---------------------------------------------------------------
  describe("verifyAccessToken()", () => {
    it("validates token via /api/token-info and returns AuthInfo", async () => {
      const tokenInfo = {
        clientId: "my-client",
        scopes: ["read", "route"],
        expiresAt: "2027-01-01T00:00:00Z",
      };

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => tokenInfo,
      });

      const result = await provider.verifyAccessToken("lr_testtoken123");

      expect(global.fetch).toHaveBeenCalledWith(`${APP_URL}/api/token-info`, {
        headers: {
          Authorization: "Bearer lr_testtoken123",
          "Content-Type": "application/json",
        },
      });

      expect(result.token).toBe("lr_testtoken123");
      expect(result.clientId).toBe("my-client");
      expect(result.scopes).toEqual(["read", "route"]);
      expect(result.expiresAt).toBe(Math.floor(new Date("2027-01-01T00:00:00Z").getTime() / 1000));
    });

    it("uses default scopes when token-info returns none", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const result = await provider.verifyAccessToken("lr_abc");

      expect(result.clientId).toBe("unknown");
      expect(result.scopes).toEqual(["read", "route"]);
      expect(result.expiresAt).toBeTypeOf("number");
      expect(result.expiresAt).toBeGreaterThan(Date.now() / 1000);
    });

    it("throws on invalid token (non-lr_ prefix)", async () => {
      await expect(provider.verifyAccessToken("bad_token")).rejects.toThrow(
        "Invalid token format",
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("throws on 401 from token-info endpoint", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(provider.verifyAccessToken("lr_expired")).rejects.toThrow(
        "Invalid or expired token",
      );
    });
  });

  // ---------------------------------------------------------------
  // exchangeRefreshToken()
  // ---------------------------------------------------------------
  describe("exchangeRefreshToken()", () => {
    it('throws "not supported"', async () => {
      await expect(provider.exchangeRefreshToken()).rejects.toThrow(
        "Refresh tokens are not supported",
      );
    });
  });

  // ---------------------------------------------------------------
  // skipLocalPkceValidation
  // ---------------------------------------------------------------
  describe("skipLocalPkceValidation", () => {
    it("is true", () => {
      expect(provider.skipLocalPkceValidation).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // revokeToken()
  // ---------------------------------------------------------------
  describe("revokeToken()", () => {
    it("sends best-effort revocation request", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      const client = makeClient();
      const request: OAuthTokenRevocationRequest = { token: "lr_revokeme" };

      await provider.revokeToken(client, request);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe(`${APP_URL}/api/tokens/revoke`);
      expect(opts.method).toBe("POST");
      expect(opts.headers.Authorization).toBe("Bearer lr_revokeme");
      expect(JSON.parse(opts.body)).toHaveProperty("tokenHash");
    });

    it("does not throw when revocation fails", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error"),
      );

      const client = makeClient();
      const request: OAuthTokenRevocationRequest = { token: "lr_fail" };

      // Should not throw
      await expect(provider.revokeToken(client, request)).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------
  // constructor
  // ---------------------------------------------------------------
  describe("constructor", () => {
    it("strips trailing slash from appUrl", () => {
      const p = new LeadRoutingOAuthProvider("https://app.example.com/");
      const res = makeRes();
      const client = makeClient();
      const params: AuthorizationParams = {
        redirectUri: "https://cb.example.com",
        codeChallenge: "ch",
      };

      p.authorize(client, params, res);

      const redirectUrl = new URL(res.redirect.mock.calls[0][0]);
      expect(redirectUrl.origin).toBe("https://app.example.com");
    });
  });
});
