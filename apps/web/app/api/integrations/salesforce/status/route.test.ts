import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetOrgIdFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  organization: {
    findUnique: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ getOrgIdFromHeaders: mockGetOrgIdFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { GET } from "./route";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgIdFromHeaders.mockResolvedValue("org-1");
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/integrations/salesforce/status", () => {
  it("returns full status for a connected org", async () => {
    const deployedAt = new Date("2025-06-01T12:00:00Z");
    const syncedAt = new Date("2025-06-02T08:00:00Z");

    mockPrisma.organization.findUnique.mockResolvedValue({
      sfdcOrgId: "00D123456789",
      sfdcInstanceUrl: "https://test.salesforce.com",
      oauthAccessToken: "token-abc",
      packageDeployedAt: deployedAt,
      packageVersion: "1.0.0",
      objectConfig: { Lead: { enabled: true } },
      fieldsSyncedAt: syncedAt,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      connected: true,
      sfdcOrgId: "00D123456789",
      sfdcInstanceUrl: "https://test.salesforce.com",
      packageDeployedAt: "2025-06-01T12:00:00.000Z",
      packageVersion: "1.0.0",
      objectConfig: { Lead: { enabled: true } },
      fieldsSyncedAt: "2025-06-02T08:00:00.000Z",
    });
  });

  it("returns connected=false when tokens are missing", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      sfdcOrgId: null,
      sfdcInstanceUrl: null,
      oauthAccessToken: null,
      packageDeployedAt: null,
      packageVersion: null,
      objectConfig: null,
      fieldsSyncedAt: null,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.connected).toBe(false);
    expect(body.sfdcOrgId).toBeNull();
    expect(body.sfdcInstanceUrl).toBeNull();
    expect(body.packageDeployedAt).toBeNull();
  });

  it("returns 404 when org not found", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Organization not found");
  });

  it("returns 500 when auth fails", async () => {
    mockGetOrgIdFromHeaders.mockRejectedValue(new Error("Missing x-org-id header"));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Internal server error");
  });
});
