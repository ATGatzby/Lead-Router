import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetOrgIdFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  organization: {
    update: vi.fn(),
  },
}));

vi.mock("@/lib/auth", () => ({ getOrgIdFromHeaders: mockGetOrgIdFromHeaders }));
vi.mock("@lead-routing/db", () => ({
  prisma: mockPrisma,
  Prisma: { DbNull: Symbol.for("prisma.DbNull") },
}));

import { POST } from "./route";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgIdFromHeaders.mockResolvedValue("org-1");
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/integrations/salesforce/disconnect", () => {
  it("returns success and clears all SFDC fields", async () => {
    mockPrisma.organization.update.mockResolvedValue({});

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });

    expect(mockPrisma.organization.update).toHaveBeenCalledOnce();
    const call = mockPrisma.organization.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: "org-1" });
    expect(call.data.sfdcOrgId).toBeNull();
    expect(call.data.sfdcInstanceUrl).toBeNull();
    expect(call.data.oauthAccessToken).toBeNull();
    expect(call.data.oauthRefreshToken).toBeNull();
    expect(call.data.packageDeployedAt).toBeNull();
    expect(call.data.packageDeployId).toBeNull();
    expect(call.data.packageVersion).toBeNull();
    expect(call.data.fieldsSyncedAt).toBeNull();
    expect(call.data.onboardingDone).toBe(false);
    // objectConfig uses Prisma.DbNull (a special symbol)
    expect(call.data.objectConfig).toBeDefined();
  });

  it("returns 500 when getOrgIdFromHeaders throws", async () => {
    mockGetOrgIdFromHeaders.mockRejectedValue(
      new Error("Missing x-org-id header")
    );

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Missing x-org-id header");
    expect(mockPrisma.organization.update).not.toHaveBeenCalled();
  });

  it("returns 500 with error message when prisma update throws", async () => {
    mockPrisma.organization.update.mockRejectedValue(
      new Error("Record not found")
    );

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Record not found");
  });

  it("returns generic error message for non-Error throws", async () => {
    mockPrisma.organization.update.mockRejectedValue("unexpected string error");

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Internal server error");
  });

  it("clears all ten expected fields", async () => {
    mockPrisma.organization.update.mockResolvedValue({});

    await POST();

    const updateData = mockPrisma.organization.update.mock.calls[0][0].data;
    const expectedFields = [
      "sfdcOrgId",
      "sfdcInstanceUrl",
      "oauthAccessToken",
      "oauthRefreshToken",
      "packageDeployedAt",
      "packageDeployId",
      "packageVersion",
      "objectConfig",
      "fieldsSyncedAt",
      "onboardingDone",
    ];

    for (const field of expectedFields) {
      expect(updateData).toHaveProperty(field);
    }

    expect(Object.keys(updateData)).toHaveLength(expectedFields.length);
  });
});
