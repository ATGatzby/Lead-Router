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

describe("GET /api/integrations/salesforce/deploy/status", () => {
  it("returns deploy status when org exists", async () => {
    const deployedAt = new Date("2025-06-01T12:00:00Z");
    mockPrisma.organization.findUnique.mockResolvedValue({
      packageDeployedAt: deployedAt,
      packageDeployId: "deploy-123",
      packageVersion: "1.0.0",
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      packageDeployedAt: "2025-06-01T12:00:00.000Z",
      packageDeployId: "deploy-123",
      packageVersion: "1.0.0",
    });
  });

  it("returns null values when package has not been deployed", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      packageDeployedAt: null,
      packageDeployId: null,
      packageVersion: null,
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      packageDeployedAt: null,
      packageDeployId: null,
      packageVersion: null,
    });
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
