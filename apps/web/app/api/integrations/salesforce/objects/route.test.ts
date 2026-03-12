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

vi.mock("@/lib/auth", () => ({ getOrgIdFromHeaders: mockGetOrgIdFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { GET, POST } from "./route";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgIdFromHeaders.mockResolvedValue("org-1");
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
