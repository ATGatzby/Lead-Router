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
const mockResolveBearerOrgId = vi.hoisted(() => vi.fn());

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
vi.mock("@/lib/bearer-auth", () => ({
  resolveBearerOrgId: mockResolveBearerOrgId,
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

  // Default: no Bearer token
  mockResolveBearerOrgId.mockResolvedValue(null);

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

  it("returns 401 when both x-sfdc-org-id header and Bearer token are missing", async () => {
    mockHeaders.mockResolvedValue(new Headers());
    mockResolveBearerOrgId.mockResolvedValue(null);

    const res = await POST(makeRequest("LEAD"));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Missing X-Sfdc-Org-Id header or Bearer token");
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

// ─── Bearer Token Auth Tests ────────────────────────────────────────────────

describe("POST /api/fields/sync — Bearer token auth", () => {
  beforeEach(() => {
    mockGetTierLimits.mockReturnValue({
      allowedTriggers: ["LEAD", "CONTACT", "ACCOUNT"],
    });
  });

  it("syncs successfully when Bearer token resolves to an org (no x-sfdc-org-id)", async () => {
    // Simulate proxy behaviour for /api/fields/sync (a public prefix):
    //   proxy short-circuits → does NOT inject x-org-id;
    //   route handler must call resolveBearerOrgId() itself.
    mockHeaders.mockResolvedValue(
      new Headers({ authorization: "Bearer lr_abc123" }),
    );
    mockResolveBearerOrgId.mockResolvedValue("org-1");

    mockPrisma.organization.findUnique.mockResolvedValue({
      id: "org-1",
      sfdcOrgId: "00D000000000099",
      oauthAccessToken: "token",
      oauthRefreshToken: "refresh",
      sfdcInstanceUrl: "https://test.salesforce.com",
    });

    const req = new NextRequest(
      "http://localhost/api/fields/sync?object=LEAD",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: "Bearer lr_abc123",
        },
        body: JSON.stringify({}),
      },
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.synced).toBe(42);
    expect(body.objectType).toBe("LEAD");
    // findUnique should be called with id (Bearer path), not sfdcOrgId
    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-1" } }),
    );
  });

  it("returns 400 when Bearer org has no Salesforce connection", async () => {
    mockHeaders.mockResolvedValue(
      new Headers({ authorization: "Bearer lr_abc123" }),
    );
    mockResolveBearerOrgId.mockResolvedValue("org-1");

    mockPrisma.organization.findUnique.mockResolvedValue({
      id: "org-1",
      sfdcOrgId: null,
      oauthAccessToken: null,
      oauthRefreshToken: null,
      sfdcInstanceUrl: null,
    });

    const req = new NextRequest(
      "http://localhost/api/fields/sync?object=LEAD",
      {
        method: "POST",
        headers: { authorization: "Bearer lr_abc123" },
        body: JSON.stringify({}),
      },
    );

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Salesforce org not connected");
  });

  it("prefers x-sfdc-org-id over Bearer when both are present (Apex parity)", async () => {
    // Apex caller has BOTH the header and (theoretically) some authz.
    // The route must take the Apex path so HMAC validation can run.
    mockHeaders.mockResolvedValue(
      new Headers({
        "x-sfdc-org-id": "00D000000000001",
        authorization: "Bearer lr_should_be_ignored",
      }),
    );
    mockResolveBearerOrgId.mockResolvedValue("some-other-org");

    const res = await POST(makeRequest("LEAD"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.synced).toBe(42);
    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sfdcOrgId: "00D000000000001" } }),
    );
  });
});
