import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockFindUniqueOrThrow = vi.hoisted(() => vi.fn());
const mockOrgUpdate = vi.hoisted(() => vi.fn());
const mockCreateConnection = vi.hoisted(() => vi.fn());

vi.mock("@lead-routing/db", () => ({
  prisma: {
    organization: {
      findUniqueOrThrow: mockFindUniqueOrThrow,
      update: mockOrgUpdate,
    },
    user: { findUnique: vi.fn() },
    sfdcQueue: { findUnique: vi.fn() },
  },
}));

vi.mock("@lead-routing/sfdc", () => ({
  createConnection: mockCreateConnection,
}));

// Import after mocks
import { getOrgConnection, evictOrgConnection } from "./sfdc.js";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Clear the internal connCache between tests by evicting known orgs
  evictOrgConnection("org-1");
  evictOrgConnection("org-2");
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getOrgConnection", () => {
  const orgTokens = {
    oauthAccessToken: "access-123",
    oauthRefreshToken: "refresh-456",
    sfdcInstanceUrl: "https://na1.salesforce.com",
  };

  it("creates a connection with tokens from DB on first call", async () => {
    const mockConn = { accessToken: "access-123" };
    mockFindUniqueOrThrow.mockResolvedValue(orgTokens);
    mockCreateConnection.mockReturnValue(mockConn);

    const conn = await getOrgConnection("org-1");

    expect(conn).toBe(mockConn);
    expect(mockFindUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: "org-1" },
      select: { oauthAccessToken: true, oauthRefreshToken: true, sfdcInstanceUrl: true },
    });
    expect(mockCreateConnection).toHaveBeenCalledWith(
      {
        accessToken: "access-123",
        refreshToken: "refresh-456",
        instanceUrl: "https://na1.salesforce.com",
      },
      expect.any(Function) // onTokenRefresh callback
    );
  });

  it("returns cached connection on subsequent calls", async () => {
    const mockConn = { accessToken: "access-123" };
    mockFindUniqueOrThrow.mockResolvedValue(orgTokens);
    mockCreateConnection.mockReturnValue(mockConn);

    const conn1 = await getOrgConnection("org-1");
    const conn2 = await getOrgConnection("org-1");

    expect(conn1).toBe(conn2);
    expect(mockFindUniqueOrThrow).toHaveBeenCalledTimes(1); // Only fetched once
    expect(mockCreateConnection).toHaveBeenCalledTimes(1);
  });

  it("passes onTokenRefresh callback that persists new token to DB", async () => {
    mockFindUniqueOrThrow.mockResolvedValue(orgTokens);
    mockCreateConnection.mockReturnValue({ accessToken: "access-123" });
    mockOrgUpdate.mockResolvedValue({});

    await getOrgConnection("org-1");

    // Extract the onTokenRefresh callback passed to createConnection
    const onTokenRefresh = mockCreateConnection.mock.calls[0][1];
    expect(onTokenRefresh).toBeTypeOf("function");

    // Simulate jsforce refresh event
    await onTokenRefresh("new-access-token");

    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { oauthAccessToken: "new-access-token" },
    });
  });
});

describe("evictOrgConnection", () => {
  it("removes cached connection so next call fetches from DB", async () => {
    const orgTokens = {
      oauthAccessToken: "access-123",
      oauthRefreshToken: "refresh-456",
      sfdcInstanceUrl: "https://na1.salesforce.com",
    };
    mockFindUniqueOrThrow.mockResolvedValue(orgTokens);
    mockCreateConnection.mockReturnValue({ accessToken: "access-123" });

    await getOrgConnection("org-1");
    expect(mockFindUniqueOrThrow).toHaveBeenCalledTimes(1);

    // Evict
    evictOrgConnection("org-1");

    // Next call should fetch from DB again
    await getOrgConnection("org-1");
    expect(mockFindUniqueOrThrow).toHaveBeenCalledTimes(2);
    expect(mockCreateConnection).toHaveBeenCalledTimes(2);
  });

  it("does not throw when evicting non-existent org", () => {
    expect(() => evictOrgConnection("non-existent")).not.toThrow();
  });
});
