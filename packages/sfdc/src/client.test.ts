import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnection = vi.hoisted(() => {
  return vi.fn();
});

vi.mock("jsforce", () => ({
  default: {
    Connection: mockConnection,
  },
}));

import {
  generatePkceVerifier,
  generatePkceChallenge,
  getSfdcAuthUrl,
  createConnection,
} from "./client.js";
import { MANAGED_PACKAGE_CLIENT_ID, OAUTH_REDIRECT_URL } from "./constants";

describe("generatePkceVerifier", () => {
  it("returns a 43-char base64url string", () => {
    const verifier = generatePkceVerifier();
    expect(verifier).toHaveLength(43);
    // base64url uses only [A-Za-z0-9_-]
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns different values on subsequent calls", () => {
    const a = generatePkceVerifier();
    const b = generatePkceVerifier();
    expect(a).not.toBe(b);
  });
});

describe("generatePkceChallenge", () => {
  it("produces a SHA-256 base64url digest of the verifier", () => {
    const verifier = generatePkceVerifier();
    const challenge = generatePkceChallenge(verifier);

    // base64url encoded SHA-256 is 43 chars
    expect(challenge).toHaveLength(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is deterministic for the same verifier", () => {
    const verifier = "test-verifier-value-for-determinism-check1";
    const a = generatePkceChallenge(verifier);
    const b = generatePkceChallenge(verifier);
    expect(a).toBe(b);
  });
});

describe("getSfdcAuthUrl", () => {
  beforeEach(() => {
    process.env.SFDC_LOGIN_URL = "https://login.salesforce.com";
  });

  it("builds correct URL with managed package client_id and redirect URL", () => {
    const url = getSfdcAuthUrl();
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://login.salesforce.com");
    expect(parsed.pathname).toBe("/services/oauth2/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe(MANAGED_PACKAGE_CLIENT_ID);
    expect(parsed.searchParams.get("redirect_uri")).toBe(OAUTH_REDIRECT_URL);
    expect(parsed.searchParams.get("scope")).toBe("api refresh_token");
  });

  it("includes PKCE challenge when provided", () => {
    const challenge = "test-challenge-value";
    const url = getSfdcAuthUrl(challenge);
    const parsed = new URL(url);

    expect(parsed.searchParams.get("code_challenge")).toBe(challenge);
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("omits PKCE params when no challenge provided", () => {
    const url = getSfdcAuthUrl();
    const parsed = new URL(url);

    expect(parsed.searchParams.has("code_challenge")).toBe(false);
    expect(parsed.searchParams.has("code_challenge_method")).toBe(false);
  });
});

describe("createConnection", () => {
  const mockOn = vi.fn();

  beforeEach(() => {
    mockConnection.mockClear();
    mockOn.mockClear();
    mockConnection.mockImplementation(() => ({ on: mockOn }));
    process.env.SFDC_LOGIN_URL = "https://login.salesforce.com";
    process.env.SFDC_CLIENT_SECRET = "test-client-secret";
  });

  const tokens = {
    accessToken: "access-123",
    refreshToken: "refresh-456",
    instanceUrl: "https://na1.salesforce.com",
  };

  it("returns a jsforce Connection with managed package constants", () => {
    createConnection(tokens);

    expect(mockConnection).toHaveBeenCalledWith({
      oauth2: {
        loginUrl: "https://login.salesforce.com",
        clientId: MANAGED_PACKAGE_CLIENT_ID,
        clientSecret: "test-client-secret",
        redirectUri: OAUTH_REDIRECT_URL,
      },
      accessToken: "access-123",
      refreshToken: "refresh-456",
      instanceUrl: "https://na1.salesforce.com",
    });
  });

  it("registers refresh event listener when onTokenRefresh is provided", () => {
    const onRefresh = vi.fn();
    createConnection(tokens, onRefresh);

    expect(mockOn).toHaveBeenCalledWith("refresh", onRefresh);
  });

  it("does NOT register refresh event listener when onTokenRefresh is omitted", () => {
    createConnection(tokens);

    expect(mockOn).not.toHaveBeenCalled();
  });

  it("does NOT register refresh event listener when onTokenRefresh is undefined", () => {
    createConnection(tokens, undefined);

    expect(mockOn).not.toHaveBeenCalled();
  });
});
