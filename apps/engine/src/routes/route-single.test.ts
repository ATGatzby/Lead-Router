import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ─── Mocks ────────────────────────────────────────────────────────────────

const {
  mockFindUnique,
  mockUpdate,
  mockRoutingLogCreate,
  mockClaimIdempotencyKey,
  mockRouteRecord,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockRoutingLogCreate: vi.fn(),
  mockClaimIdempotencyKey: vi.fn(),
  mockRouteRecord: vi.fn(),
}));

vi.mock("@lead-routing/db", () => ({
  prisma: {
    organization: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
    routingLog: {
      create: mockRoutingLogCreate,
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
  getPlanLimits: vi.fn().mockReturnValue({ routingLeadsPerMonth: 10000 }),
  startOfNextMonth: vi.fn().mockReturnValue(new Date("2026-04-01")),
}));

vi.mock("../idempotency.js", () => ({
  claimIdempotencyKey: (...args: unknown[]) => mockClaimIdempotencyKey(...args),
  claimIdempotencyKeys: vi.fn(),
}));

vi.mock("../router.js", () => ({
  routeRecord: (...args: unknown[]) => mockRouteRecord(...args),
}));

vi.mock("../batch-queue.js", () => ({
  enqueueBatchJobs: vi.fn().mockResolvedValue(undefined),
  batchQueue: {},
  batchWorker: { on: vi.fn() },
}));

vi.mock("../redis.js", () => ({
  redis: {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
  },
}));

vi.mock("../lib/strip-pii.js", () => ({
  stripPii: vi.fn((fields: Record<string, unknown>) => fields),
}));

// ─── Fastify setup ────────────────────────────────────────────────────────

import Fastify from "fastify";
import { routePlugin } from "./route.js";

const SECRET = "test-secret";

function sign(body: string): string {
  const hmac = crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  return `sha256=${hmac}`;
}

function makeOrg(overrides = {}) {
  return {
    id: "org-1",
    webhookSecret: SECRET,
    plan: "PAID",
    isActive: true,
    routingQuotaUsed: 0,
    quotaResetAt: new Date("2026-04-01"),
    ...overrides,
  };
}

function makeSingleBody(overrides = {}) {
  return {
    sfdcOrgId: "00D000000000001",
    objectType: "LEAD",
    eventType: "INSERT",
    recordId: "00Q000000000001",
    timestamp: "2026-03-10T00:00:00Z",
    fields: { Email: "test@example.com", Company: "Acme" },
    ...overrides,
  };
}

/** Helper: inject a signed POST /route request */
async function injectSingle(
  app: ReturnType<typeof Fastify>,
  body: Record<string, unknown>,
  headerOverrides: Record<string, string> = {},
) {
  const bodyStr = JSON.stringify(body);
  return app.inject({
    method: "POST",
    url: "/route",
    headers: {
      "content-type": "application/json",
      "x-signature-256": sign(bodyStr),
      ...headerOverrides,
    },
    payload: bodyStr,
  });
}

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({});
  mockRoutingLogCreate.mockResolvedValue({});
  mockClaimIdempotencyKey.mockResolvedValue(true);
  mockRouteRecord.mockResolvedValue("routed");

  app = Fastify();
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    try {
      (req as any).rawBody = body as string;
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });
  await app.register(routePlugin);
  await app.ready();
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe("POST /route (single)", () => {
  // ── 1. Missing required fields ──────────────────────────────────────────

  it("returns 400 when sfdcOrgId is missing", async () => {
    const res = await injectSingle(app, makeSingleBody({ sfdcOrgId: undefined }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Invalid payload");
  });

  it("returns 400 when objectType is missing", async () => {
    const res = await injectSingle(app, makeSingleBody({ objectType: undefined }));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when eventType is missing", async () => {
    const res = await injectSingle(app, makeSingleBody({ eventType: undefined }));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when recordId is missing", async () => {
    const res = await injectSingle(app, makeSingleBody({ recordId: undefined }));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when timestamp is missing", async () => {
    const res = await injectSingle(app, makeSingleBody({ timestamp: undefined }));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fields is missing", async () => {
    const res = await injectSingle(app, makeSingleBody({ fields: undefined }));
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for completely empty body", async () => {
    const res = await injectSingle(app, {});
    expect(res.statusCode).toBe(400);
  });

  // ── 2. Unknown org ──────────────────────────────────────────────────────

  it("returns 401 when org is not found", async () => {
    mockFindUnique.mockResolvedValue(null);

    const res = await injectSingle(app, makeSingleBody());
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe("Unknown org");
  });

  // ── 3. Missing X-Signature-256 header ───────────────────────────────────

  it("returns 401 when X-Signature-256 header is missing", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());

    const body = makeSingleBody();
    const bodyStr = JSON.stringify(body);

    const res = await app.inject({
      method: "POST",
      url: "/route",
      headers: {
        "content-type": "application/json",
        // deliberately omit x-signature-256
      },
      payload: bodyStr,
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe("Missing X-Signature-256 header");
  });

  // ── 4. Invalid HMAC signature ───────────────────────────────────────────

  it("returns 401 when HMAC signature is invalid", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());

    const res = await injectSingle(app, makeSingleBody(), {
      "x-signature-256": "sha256=0000000000000000000000000000000000000000000000000000000000000000",
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe("Invalid signature");
  });

  // ── 5. Suspended org ────────────────────────────────────────────────────

  it("returns 403 for suspended org and creates FAILED routing log", async () => {
    mockFindUnique.mockResolvedValue(makeOrg({ isActive: false }));

    const body = makeSingleBody();
    const res = await injectSingle(app, body);

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toBe("Organization is suspended");

    // Verify FAILED routing log was created
    expect(mockRoutingLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        sfdcRecordId: body.recordId,
        objectType: "LEAD",
        eventType: "INSERT",
        status: "FAILED",
        errorMessage: "Organization is suspended",
        recordSnapshot: body.fields,
      }),
    });
  });

  // ── 6. Lazy quota reset ─────────────────────────────────────────────────

  it("resets quota when quotaResetAt is in the past", async () => {
    mockFindUnique.mockResolvedValue(
      makeOrg({
        routingQuotaUsed: 5000,
        quotaResetAt: new Date("2025-01-01"), // in the past
      }),
    );

    const res = await injectSingle(app, makeSingleBody());

    expect(res.statusCode).toBe(200);

    // Verify quota was reset to 0
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-1" },
        data: { routingQuotaUsed: 0, quotaResetAt: new Date("2026-04-01") },
      }),
    );

    // Verify routeRecord was still called (quota reset allowed the request through)
    expect(mockRouteRecord).toHaveBeenCalledTimes(1);
  });

  // ── 7. Quota exceeded ──────────────────────────────────────────────────

  it("returns 429 when quota is exceeded and creates FAILED routing log", async () => {
    mockFindUnique.mockResolvedValue(makeOrg({ routingQuotaUsed: 10000 }));

    const body = makeSingleBody();
    const res = await injectSingle(app, body);

    expect(res.statusCode).toBe(429);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("quota_exceeded");
    expect(json.plan).toBe("PAID");
    expect(json.limit).toBe(10000);
    expect(json.used).toBe(10000);

    // Verify FAILED routing log
    expect(mockRoutingLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        status: "FAILED",
        errorMessage: expect.stringContaining("Quota exceeded"),
      }),
    });

    // routeRecord should NOT have been called
    expect(mockRouteRecord).not.toHaveBeenCalled();
  });

  it("returns 429 when quota is already over limit", async () => {
    mockFindUnique.mockResolvedValue(makeOrg({ routingQuotaUsed: 15000 }));

    const res = await injectSingle(app, makeSingleBody());
    expect(res.statusCode).toBe(429);
  });

  // ── 8. Duplicate detection ──────────────────────────────────────────────

  it("returns duplicate status when idempotency key already claimed", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());
    mockClaimIdempotencyKey.mockResolvedValue(false);

    const res = await injectSingle(app, makeSingleBody());

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe("duplicate");
    expect(json.latencyMs).toBeDefined();

    // routeRecord should NOT have been called
    expect(mockRouteRecord).not.toHaveBeenCalled();
  });

  it("passes correct args to claimIdempotencyKey", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());
    mockClaimIdempotencyKey.mockResolvedValue(true);

    const body = makeSingleBody();
    await injectSingle(app, body);

    expect(mockClaimIdempotencyKey).toHaveBeenCalledWith(
      "org-1",
      body.recordId,
      body.eventType,
      body.timestamp,
    );
  });

  // ── 9. Successful routing ───────────────────────────────────────────────

  it("returns routed status and increments quota on successful routing", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());
    mockRouteRecord.mockResolvedValue("routed");

    const body = makeSingleBody();
    const res = await injectSingle(app, body);

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe("routed");
    expect(json.latencyMs).toBeDefined();
    expect(typeof json.latencyMs).toBe("number");

    // Verify quota was incremented
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-1" },
        data: { routingQuotaUsed: { increment: 1 } },
      }),
    );
  });

  it("passes correct payload to routeRecord", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());

    const body = makeSingleBody();
    await injectSingle(app, body);

    expect(mockRouteRecord).toHaveBeenCalledWith(
      {
        orgId: "org-1",
        objectType: "LEAD",
        eventType: "INSERT",
        recordId: body.recordId,
        timestamp: body.timestamp,
        fields: body.fields,
      },
      expect.any(Number),
    );
  });

  // ── 10. Unmatched routing ───────────────────────────────────────────────

  it("returns unmatched status and does NOT increment quota", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());
    mockRouteRecord.mockResolvedValue("unmatched");

    const res = await injectSingle(app, makeSingleBody());

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe("unmatched");
    expect(json.latencyMs).toBeDefined();

    // Quota should NOT be incremented for unmatched
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── 11. Internal error handling ─────────────────────────────────────────

  it("returns 500 and creates FAILED routing log when routeRecord throws", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());
    mockRouteRecord.mockRejectedValue(new Error("SFDC API timeout"));

    const body = makeSingleBody();
    const res = await injectSingle(app, body);

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe("Internal routing error");

    // Verify FAILED routing log with error message
    expect(mockRoutingLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: "org-1",
        sfdcRecordId: body.recordId,
        objectType: "LEAD",
        eventType: "INSERT",
        status: "FAILED",
        errorMessage: "Internal routing error: SFDC API timeout",
        recordSnapshot: body.fields,
      }),
    });
  });

  it("handles non-Error thrown values in error path", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());
    mockRouteRecord.mockRejectedValue("string error");

    const res = await injectSingle(app, makeSingleBody());

    expect(res.statusCode).toBe(500);
    expect(mockRoutingLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        errorMessage: "Internal routing error: string error",
      }),
    });
  });

  it("does not increment quota when routeRecord throws", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());
    mockRouteRecord.mockRejectedValue(new Error("boom"));

    await injectSingle(app, makeSingleBody());

    // update should NOT have been called (no quota increment)
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
