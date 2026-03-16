import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetOrgIdFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  organization: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
const mockGetTierLimits = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ getOrgIdFromHeaders: mockGetOrgIdFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/license", () => ({
  getTierLimits: mockGetTierLimits,
  upgradeRequiredResponse: (feature: string) =>
    Response.json(
      {
        error: "upgrade_required",
        message: `${feature} requires a Pro license. Upgrade at https://openedgeai.tech/pricing`,
        tier: "free",
      },
      { status: 402 },
    ),
}));

import { GET, POST } from "./route";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgIdFromHeaders.mockResolvedValue("org-1");
  // Default to pro tier (all objects allowed) so existing tests pass unchanged
  mockGetTierLimits.mockReturnValue({
    allowedTriggers: ["LEAD", "CONTACT", "ACCOUNT"],
    weightedDistribution: true,
    analytics: true,
  });
});

// ─── GET Tests ───────────────────────────────────────────────────────────────

describe("GET /api/integrations/salesforce/objects", () => {
  it("returns objectConfig when org exists", async () => {
    const config = { Lead: { enabled: true }, Contact: { enabled: false } };
    mockPrisma.organization.findUnique.mockResolvedValue({ objectConfig: config });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ objectConfig: config });
  });

  it("returns null when no objectConfig set", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ objectConfig: null });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ objectConfig: null });
  });

  it("returns 404 when org not found", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Organization not found");
  });
});

// ─── POST Tests ──────────────────────────────────────────────────────────────

describe("POST /api/integrations/salesforce/objects", () => {
  function makeRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/integrations/salesforce/objects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("saves valid objectConfig", async () => {
    const config = { Lead: { enabled: true }, Contact: { enabled: false } };
    mockPrisma.organization.update.mockResolvedValue({ objectConfig: config });

    const res = await POST(makeRequest({ objectConfig: config }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ objectConfig: config });
    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { objectConfig: config },
      select: { objectConfig: true },
    });
  });

  it("returns 400 when objectConfig is missing", async () => {
    const res = await POST(makeRequest({}));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("objectConfig must be an object");
  });

  it("returns 400 when objectConfig is not an object", async () => {
    const res = await POST(makeRequest({ objectConfig: "invalid" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("objectConfig must be an object");
  });

  it("returns 400 when entry lacks enabled boolean", async () => {
    const res = await POST(makeRequest({ objectConfig: { Lead: { enabled: "yes" } } }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Lead");
    expect(body.error).toContain("enabled: boolean");
  });

  it("returns 500 when auth fails", async () => {
    mockGetOrgIdFromHeaders.mockRejectedValue(new Error("Missing x-org-id header"));

    const res = await POST(makeRequest({ objectConfig: { Lead: { enabled: true } } }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Internal server error");
  });
});

// ─── Tier Gating Tests ─────────────────────────────────────────────────────

describe("POST /api/integrations/salesforce/objects — free tier gating", () => {
  function makeRequest(body: unknown): NextRequest {
    return new NextRequest("http://localhost/api/integrations/salesforce/objects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => {
    // Free tier: only LEAD allowed
    mockGetTierLimits.mockReturnValue({
      allowedTriggers: ["LEAD"],
      weightedDistribution: false,
      analytics: false,
    });
  });

  it("free tier: enabling Lead object succeeds", async () => {
    const config = { Lead: { enabled: true } };
    mockPrisma.organization.update.mockResolvedValue({ objectConfig: config });

    const res = await POST(makeRequest({ objectConfig: config }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.objectConfig).toEqual(config);
  });

  it("free tier: enabling Contact object returns 402", async () => {
    const res = await POST(
      makeRequest({ objectConfig: { Contact: { enabled: true } } }),
    );
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toBe("upgrade_required");
    expect(body.message).toContain("Contact");
  });

  it("free tier: enabling Account object returns 402", async () => {
    const res = await POST(
      makeRequest({ objectConfig: { Account: { enabled: true } } }),
    );
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toBe("upgrade_required");
    expect(body.message).toContain("Account");
  });

  it("free tier: disabling Contact object is allowed (enabled: false)", async () => {
    const config = { Contact: { enabled: false } };
    mockPrisma.organization.update.mockResolvedValue({ objectConfig: config });

    const res = await POST(makeRequest({ objectConfig: config }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.objectConfig).toEqual(config);
  });

  it("free tier: mixed config with Contact enabled returns 402", async () => {
    const res = await POST(
      makeRequest({
        objectConfig: {
          Lead: { enabled: true },
          Contact: { enabled: true },
        },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toBe("upgrade_required");
  });
});
