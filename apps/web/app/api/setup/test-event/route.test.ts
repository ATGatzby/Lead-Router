import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  organization: {
    findUnique: vi.fn(),
  },
}));
const mockResolveBearerOrgId = vi.hoisted(() => vi.fn());

vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/bearer-auth", () => ({
  resolveBearerOrgId: mockResolveBearerOrgId,
}));

import { POST } from "./route";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBearerRequest(): NextRequest {
  return new NextRequest("http://localhost/api/setup/test-event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authorization: "Bearer lr_abc123",
    },
    body: JSON.stringify({}),
  });
}

function makeApexRequest(): NextRequest {
  return new NextRequest("http://localhost/api/setup/test-event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sfdc-org-id": "00D000000000001",
    },
    body: JSON.stringify({}),
  });
}

const fakeOrg = {
  id: "org-1",
  sfdcOrgId: "00D000000000001",
  webhookSecret: "secret-shh",
};

// Use vi.fn for fetch instead of spyOn to avoid TS overload-resolution noise.
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.organization.findUnique.mockResolvedValue(fakeOrg);
  mockResolveBearerOrgId.mockResolvedValue("org-1");

  // Default: engine returns 200
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ routed: true, ruleId: "rule-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = fetchMock;
});

// ─── Auth Tests ─────────────────────────────────────────────────────────────

describe("POST /api/setup/test-event — authentication", () => {
  it("returns 401 when neither Bearer nor X-Sfdc-Org-Id present", async () => {
    mockResolveBearerOrgId.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/setup/test-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Missing X-Sfdc-Org-Id header or Bearer token");
  });

  it("resolves org via Bearer token and fires test event", async () => {
    const res = await POST(makeBearerRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.recordId).toMatch(/^TEST-\d+$/);
    expect(body.objectType).toBe("LEAD");
    expect(body.engineStatus).toBe(200);
    expect(typeof body.elapsedMs).toBe("number");
    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "org-1" } }),
    );
  });

  it("resolves org via X-Sfdc-Org-Id (Apex parity)", async () => {
    mockResolveBearerOrgId.mockResolvedValue(null);

    const res = await POST(makeApexRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.organization.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sfdcOrgId: "00D000000000001" } }),
    );
  });
});

// ─── Org/Connection Validation ──────────────────────────────────────────────

describe("POST /api/setup/test-event — org/connection state", () => {
  it("returns 404 when org not found", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);

    const res = await POST(makeBearerRequest());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Org not found");
  });

  it("returns 400 when org has no Salesforce connection", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: "org-1",
      sfdcOrgId: null,
      webhookSecret: "secret-shh",
    });

    const res = await POST(makeBearerRequest());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Salesforce org not connected/);
  });

  it("returns 500 when org has no webhookSecret", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: "org-1",
      sfdcOrgId: "00D000000000001",
      webhookSecret: null,
    });

    const res = await POST(makeBearerRequest());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toMatch(/webhookSecret missing/);
  });
});

// ─── Engine Roundtrip ───────────────────────────────────────────────────────

describe("POST /api/setup/test-event — engine roundtrip", () => {
  it("signs the engine payload with HMAC-SHA256 against the org webhookSecret", async () => {
    await POST(makeBearerRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/route$/);

    const reqInit = init as RequestInit;
    const sentBody = String(reqInit.body);
    const sig = (reqInit.headers as Record<string, string>)["X-Signature-256"];
    const expected =
      "sha256=" +
      crypto
        .createHmac("sha256", fakeOrg.webhookSecret)
        .update(sentBody)
        .digest("hex");

    expect(sig).toBe(expected);

    const parsed = JSON.parse(sentBody);
    expect(parsed.sfdcOrgId).toBe(fakeOrg.sfdcOrgId);
    expect(parsed.objectType).toBe("LEAD");
    expect(parsed.eventType).toBe("INSERT");
    expect(parsed.recordId).toMatch(/^TEST-\d+$/);
    expect(parsed.fields.Email).toBe("test@example.com");
  });

  it("returns 502 with elapsedMs when engine fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await POST(makeBearerRequest());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Engine unreachable");
    expect(body.details).toMatch(/ECONNREFUSED/);
    expect(typeof body.elapsedMs).toBe("number");
  });

  it("returns 502 with engine details when engine responds non-2xx", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "bad signature" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }) as unknown as Response,
    );

    const res = await POST(makeBearerRequest());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.ok).toBe(false);
    expect(body.engineStatus).toBe(403);
    expect(body.details).toEqual({ error: "bad signature" });
    expect(typeof body.elapsedMs).toBe("number");
  });

  it("honours caller-supplied objectType + fields override", async () => {
    const req = new NextRequest("http://localhost/api/setup/test-event", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: "Bearer lr_abc123",
      },
      body: JSON.stringify({
        objectType: "CONTACT",
        fields: { FirstName: "Override", LastName: "Person" },
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.objectType).toBe("CONTACT");

    const sentBody = String((fetchMock.mock.calls[0]![1] as RequestInit).body);
    const parsed = JSON.parse(sentBody);
    expect(parsed.objectType).toBe("CONTACT");
    expect(parsed.fields).toEqual({
      FirstName: "Override",
      LastName: "Person",
    });
  });
});
