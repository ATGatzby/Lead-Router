import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetTierLimits = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  organization: {
    findUnique: vi.fn(),
  },
}));
const mockSyncFieldSchema = vi.hoisted(() => vi.fn());
const mockCreateConnection = vi.hoisted(() => vi.fn());
const mockValidateSfdcHmac = vi.hoisted(() => vi.fn());

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
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));
vi.mock("@lead-routing/sfdc", () => ({
  createConnection: mockCreateConnection,
  syncFieldSchema: mockSyncFieldSchema,
}));
vi.mock("@/lib/validate-sfdc-hmac", () => ({
  validateSfdcHmac: mockValidateSfdcHmac,
}));
// next/headers mock — returns headers from the request
const mockHeaders = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({
  headers: mockHeaders,
}));

import { POST } from "./route";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(object: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/fields/sync?object=${object}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sfdc-org-id": "00D000000000001",
      },
      body: JSON.stringify({}),
    },
  );
}

const fakeOrg = {
  id: "org-1",
  oauthAccessToken: "token",
  oauthRefreshToken: "refresh",
  sfdcInstanceUrl: "https://test.salesforce.com",
};

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default: headers returns x-sfdc-org-id
  mockHeaders.mockResolvedValue(
    new Headers({ "x-sfdc-org-id": "00D000000000001" }),
  );

  // Default: org exists with valid tokens
  mockPrisma.organization.findUnique.mockResolvedValue(fakeOrg);

  // Default: sync succeeds
  mockCreateConnection.mockReturnValue({});
  mockSyncFieldSchema.mockResolvedValue(42);
});

// ─── Free Tier Gating Tests ────────────────────────────────────────────────

describe("POST /api/fields/sync — free tier object gating", () => {
  beforeEach(() => {
    mockGetTierLimits.mockReturnValue({
      allowedTriggers: ["LEAD"],
      weightedDistribution: false,
      analytics: false,
    });
  });

  it("free tier: LEAD object sync is allowed", async () => {
    const res = await POST(makeRequest("LEAD"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.synced).toBe(42);
    expect(body.objectType).toBe("LEAD");
  });

  it("free tier: CONTACT object sync returns 402", async () => {
    const res = await POST(makeRequest("CONTACT"));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toBe("upgrade_required");
    expect(body.message).toContain("CONTACT");
  });

  it("free tier: ACCOUNT object sync returns 402", async () => {
    const res = await POST(makeRequest("ACCOUNT"));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toBe("upgrade_required");
    expect(body.message).toContain("ACCOUNT");
  });

  it("free tier: lowercase contact is also blocked (normalized to uppercase)", async () => {
    const res = await POST(makeRequest("contact"));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toBe("upgrade_required");
  });
});

// ─── Pro Tier Tests ─────────────────────────────────────────────────────────

describe("POST /api/fields/sync — pro tier allows all objects", () => {
  beforeEach(() => {
    mockGetTierLimits.mockReturnValue({
      allowedTriggers: ["LEAD", "CONTACT", "ACCOUNT"],
      weightedDistribution: true,
      analytics: true,
    });
  });

  it("pro tier: LEAD sync succeeds", async () => {
    const res = await POST(makeRequest("LEAD"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.synced).toBe(42);
  });

  it("pro tier: CONTACT sync succeeds", async () => {
    const res = await POST(makeRequest("CONTACT"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.synced).toBe(42);
    expect(body.objectType).toBe("CONTACT");
  });

  it("pro tier: ACCOUNT sync succeeds", async () => {
    const res = await POST(makeRequest("ACCOUNT"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.synced).toBe(42);
    expect(body.objectType).toBe("ACCOUNT");
  });
});

// ─── Auth Tests ─────────────────────────────────────────────────────────────

describe("POST /api/fields/sync — authentication", () => {
  beforeEach(() => {
    mockGetTierLimits.mockReturnValue({
      allowedTriggers: ["LEAD", "CONTACT", "ACCOUNT"],
    });
  });

  it("returns 401 when x-sfdc-org-id header is missing", async () => {
    mockHeaders.mockResolvedValue(new Headers());

    const res = await POST(makeRequest("LEAD"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Missing X-Sfdc-Org-Id header");
  });

  it("returns 404 when org not found", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest("LEAD"));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Org not found");
  });

  it("returns 400 for invalid object type", async () => {
    const res = await POST(makeRequest("OPPORTUNITY"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid object type");
  });
});
