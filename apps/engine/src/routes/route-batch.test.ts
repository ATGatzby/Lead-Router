import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ─── Mocks ────────────────────────────────────────────────────────────────

const {
  mockFindUnique,
  mockUpdate,
  mockClaimIdempotencyKeys,
  mockEnqueueBatchJobs,
} = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockClaimIdempotencyKeys: vi.fn(),
  mockEnqueueBatchJobs: vi.fn(),
}));

vi.mock("@lead-routing/db", () => ({
  prisma: {
    organization: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
    routingLog: {
      create: vi.fn().mockResolvedValue({}),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
  getPlanLimits: vi.fn().mockReturnValue({ routingLeadsPerMonth: 10000 }),
  startOfNextMonth: vi.fn().mockReturnValue(new Date("2026-04-01")),
}));

vi.mock("../idempotency.js", () => ({
  claimIdempotencyKey: vi.fn().mockResolvedValue(true),
  claimIdempotencyKeys: (...args: unknown[]) => mockClaimIdempotencyKeys(...args),
}));

vi.mock("../batch-queue.js", () => ({
  enqueueBatchJobs: (...args: unknown[]) => mockEnqueueBatchJobs(...args),
  batchQueue: {},
  batchWorker: { on: vi.fn() },
}));

vi.mock("../router.js", () => ({
  routeRecord: vi.fn().mockResolvedValue("routed"),
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
    quotaResetAt: new Date("2027-01-01"),
    ...overrides,
  };
}

function makeBatchBody(overrides = {}) {
  return {
    sfdcOrgId: "00D000000000001",
    objectType: "LEAD",
    eventType: "INSERT",
    timestamp: "2026-03-10T00:00:00Z",
    records: [
      { recordId: "00Q1", fields: { Email: "a@b.com" } },
      { recordId: "00Q2", fields: { Email: "c@d.com" } },
    ],
    ...overrides,
  };
}

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockEnqueueBatchJobs.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue({});

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

describe("POST /route/batch", () => {
  it("returns 202 with accepted count for valid batch", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());
    mockClaimIdempotencyKeys.mockResolvedValue(
      new Map([["00Q1", true], ["00Q2", true]])
    );

    const body = makeBatchBody();
    const bodyStr = JSON.stringify(body);

    const res = await app.inject({
      method: "POST",
      url: "/route/batch",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(bodyStr),
      },
      payload: bodyStr,
    });

    expect(res.statusCode).toBe(202);
    const json = JSON.parse(res.body);
    expect(json.accepted).toBe(2);
    expect(json.duplicates).toBe(0);
    expect(json.batchId).toBeDefined();

    // Verify quota was pre-reserved
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "org-1" },
        data: { routingQuotaUsed: { increment: 2 } },
      })
    );

    // Verify jobs were enqueued
    expect(mockEnqueueBatchJobs).toHaveBeenCalledTimes(1);
    const jobs = mockEnqueueBatchJobs.mock.calls[0][0];
    expect(jobs).toHaveLength(2);
    expect(jobs[0].recordId).toBe("00Q1");
    expect(jobs[1].recordId).toBe("00Q2");
  });

  it("filters out duplicates from idempotency check", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());
    mockClaimIdempotencyKeys.mockResolvedValue(
      new Map([["00Q1", true], ["00Q2", false]])
    );

    const body = makeBatchBody();
    const bodyStr = JSON.stringify(body);

    const res = await app.inject({
      method: "POST",
      url: "/route/batch",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(bodyStr),
      },
      payload: bodyStr,
    });

    expect(res.statusCode).toBe(202);
    const json = JSON.parse(res.body);
    expect(json.accepted).toBe(1);
    expect(json.duplicates).toBe(1);
  });

  it("returns 202 with accepted=0 when all are duplicates", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());
    mockClaimIdempotencyKeys.mockResolvedValue(
      new Map([["00Q1", false], ["00Q2", false]])
    );

    const body = makeBatchBody();
    const bodyStr = JSON.stringify(body);

    const res = await app.inject({
      method: "POST",
      url: "/route/batch",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(bodyStr),
      },
      payload: bodyStr,
    });

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).accepted).toBe(0);
    expect(mockEnqueueBatchJobs).not.toHaveBeenCalled();
  });

  it("returns 400 for missing fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/route/batch",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ sfdcOrgId: "x" }),
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for batch exceeding 200 records", async () => {
    const records = Array.from({ length: 201 }, (_, i) => ({
      recordId: `rec${i}`,
      fields: {},
    }));
    const body = makeBatchBody({ records });
    const bodyStr = JSON.stringify(body);

    mockFindUnique.mockResolvedValue(makeOrg());

    const res = await app.inject({
      method: "POST",
      url: "/route/batch",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(bodyStr),
      },
      payload: bodyStr,
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 for unknown org", async () => {
    mockFindUnique.mockResolvedValue(null);

    const body = makeBatchBody();
    const bodyStr = JSON.stringify(body);

    const res = await app.inject({
      method: "POST",
      url: "/route/batch",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(bodyStr),
      },
      payload: bodyStr,
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 401 for invalid HMAC", async () => {
    mockFindUnique.mockResolvedValue(makeOrg());

    const body = makeBatchBody();
    const bodyStr = JSON.stringify(body);

    const res = await app.inject({
      method: "POST",
      url: "/route/batch",
      headers: {
        "content-type": "application/json",
        "x-signature-256": "sha256=invalid",
      },
      payload: bodyStr,
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for suspended org", async () => {
    mockFindUnique.mockResolvedValue(makeOrg({ isActive: false }));

    const body = makeBatchBody();
    const bodyStr = JSON.stringify(body);

    const res = await app.inject({
      method: "POST",
      url: "/route/batch",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(bodyStr),
      },
      payload: bodyStr,
    });

    expect(res.statusCode).toBe(403);
  });

  it("returns 429 when quota is exceeded", async () => {
    mockFindUnique.mockResolvedValue(
      makeOrg({ routingQuotaUsed: 10000 })
    );

    const body = makeBatchBody();
    const bodyStr = JSON.stringify(body);

    const res = await app.inject({
      method: "POST",
      url: "/route/batch",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(bodyStr),
      },
      payload: bodyStr,
    });

    expect(res.statusCode).toBe(429);
  });

  it("caps accepted records to remaining quota", async () => {
    // Quota has 1 remaining slot but batch has 2 records
    mockFindUnique.mockResolvedValue(makeOrg({ routingQuotaUsed: 9999 }));
    mockClaimIdempotencyKeys.mockResolvedValue(
      new Map([["00Q1", true], ["00Q2", true]])
    );

    const body = makeBatchBody();
    const bodyStr = JSON.stringify(body);

    const res = await app.inject({
      method: "POST",
      url: "/route/batch",
      headers: {
        "content-type": "application/json",
        "x-signature-256": sign(bodyStr),
      },
      payload: bodyStr,
    });

    expect(res.statusCode).toBe(202);
    const json = JSON.parse(res.body);
    expect(json.accepted).toBe(1);

    // Quota reserved for 1 record only
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { routingQuotaUsed: { increment: 1 } },
      })
    );
  });
});
