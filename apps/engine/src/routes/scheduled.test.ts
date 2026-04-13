import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockHgetall,
  mockSet,
  mockFindUnique,
  mockBulkSearchRunUpdate,
  mockRunScheduledRoute,
  mockBuildCountSOQL,
  mockGetOrgConnection,
} = vi.hoisted(() => ({
  mockHgetall: vi.fn(),
  mockSet: vi.fn(),
  mockFindUnique: vi.fn(),
  mockBulkSearchRunUpdate: vi.fn(),
  mockRunScheduledRoute: vi.fn(),
  mockBuildCountSOQL: vi.fn(),
  mockGetOrgConnection: vi.fn(),
}));

vi.mock("@lead-routing/db", () => ({
  prisma: {
    bulkSearchRun: {
      findUnique: mockFindUnique,
      update: mockBulkSearchRunUpdate,
    },
  },
}));

vi.mock("../redis.js", () => ({
  getRedis: () => ({
    hgetall: mockHgetall,
    set: mockSet,
  }),
}));

vi.mock("../search-runner.js", () => ({
  runScheduledRoute: (...args: unknown[]) => mockRunScheduledRoute(...args),
}));

vi.mock("../soql-builder.js", () => ({
  buildCountSOQL: (...args: unknown[]) => mockBuildCountSOQL(...args),
}));

vi.mock("../sfdc.js", () => ({
  getOrgConnection: (...args: unknown[]) => mockGetOrgConnection(...args),
}));

vi.mock("../middleware/validate-internal.js", () => ({
  validateInternalToken: (_req: unknown, _reply: unknown, done: () => void) => done(),
}));

// ─── Fastify setup ──────────────────────────────────────────────────────────

import Fastify from "fastify";
import { scheduledPlugin } from "./scheduled.js";

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockSet.mockResolvedValue("OK");
  mockBulkSearchRunUpdate.mockResolvedValue({});

  app = Fastify();
  await app.register(scheduledPlugin);
  await app.ready();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function injectStatus(runId: string) {
  return app.inject({
    method: "GET",
    url: `/bulk-run/${runId}/status`,
  });
}

function injectCancel(runId: string) {
  return app.inject({
    method: "POST",
    url: `/bulk-run/${runId}/cancel`,
  });
}

function injectRunScheduled(body: Record<string, unknown>, orgId = "org-1") {
  return app.inject({
    method: "POST",
    url: "/run-scheduled",
    headers: {
      "content-type": "application/json",
      "x-org-id": orgId,
    },
    payload: body,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /bulk-run/:runId/status
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /bulk-run/:runId/status", () => {
  it("returns live data from Redis when status is RUNNING", async () => {
    mockHgetall.mockResolvedValue({
      status: "RUNNING",
      phase: "writing",
      writePending: "42",
      processed: "100",
      routed: "80",
      failed: "5",
    });

    const res = await injectStatus("run-123");
    const json = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(json.status).toBe("RUNNING");
    expect(json.recordsProcessed).toBe(100);
    expect(json.recordsRouted).toBe(80);
    expect(json.recordsFailed).toBe(5);

    // Should NOT hit DB when Redis has live data
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns correct counts when Redis data is sparse", async () => {
    mockHgetall.mockResolvedValue({
      status: "RUNNING",
      processed: "10",
      routed: "5",
      failed: "0",
    });

    const res = await injectStatus("run-456");
    const json = JSON.parse(res.body);

    expect(json.status).toBe("RUNNING");
    expect(json.recordsProcessed).toBe(10);
    expect(json.recordsRouted).toBe(5);
    expect(json.recordsFailed).toBe(0);
  });

  it("falls back to DB when Redis has no data", async () => {
    mockHgetall.mockResolvedValue({}); // empty — no status key

    mockFindUnique.mockResolvedValue({
      id: "run-789",
      status: "COMPLETED",
      recordsFound: 200,
      recordsProcessed: 200,
      recordsRouted: 180,
      recordsFailed: 20,
      startedAt: new Date("2026-03-10T00:00:00Z"),
      completedAt: new Date("2026-03-10T00:05:00Z"),
      durationMs: 300000,
    });

    const res = await injectStatus("run-789");
    const json = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(json.status).toBe("COMPLETED");
    expect(json.recordsFound).toBe(200);
    expect(json.recordsProcessed).toBe(200);
    expect(json.recordsRouted).toBe(180);
    expect(json.recordsFailed).toBe(20);
    expect(json.durationMs).toBe(300000);
  });

  it("returns 404 when runId not found in Redis or DB", async () => {
    mockHgetall.mockResolvedValue({});
    mockFindUnique.mockResolvedValue(null);

    const res = await injectStatus("run-nonexistent");

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error).toBe("Run not found");
  });

  it("falls back to DB when Redis returns non-RUNNING status", async () => {
    mockHgetall.mockResolvedValue({ status: "COMPLETED" }); // not RUNNING

    mockFindUnique.mockResolvedValue({
      id: "run-done",
      status: "COMPLETED",
      recordsFound: 50,
      recordsProcessed: 50,
      recordsRouted: 40,
      recordsFailed: 10,
      startedAt: new Date("2026-03-10T00:00:00Z"),
      completedAt: new Date("2026-03-10T00:01:00Z"),
      durationMs: 60000,
    });

    const res = await injectStatus("run-done");
    const json = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(json.status).toBe("COMPLETED");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "run-done" } });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /bulk-run/:runId/cancel
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /bulk-run/:runId/cancel", () => {
  it("sets Redis cancel key with 1-hour TTL", async () => {
    const res = await injectCancel("run-abc");

    expect(mockSet).toHaveBeenCalledWith("bulk-run:run-abc:cancel", "1", "EX", 3600);
    expect(res.statusCode).toBe(200);
  });

  it("updates DB status to CANCELLED with completedAt", async () => {
    const beforeCall = new Date();
    const res = await injectCancel("run-abc");

    expect(mockBulkSearchRunUpdate).toHaveBeenCalledWith({
      where: { id: "run-abc" },
      data: {
        status: "CANCELLED",
        completedAt: expect.any(Date),
      },
    });

    // Verify completedAt is a recent timestamp
    const callArgs = mockBulkSearchRunUpdate.mock.calls[0][0];
    const completedAt = callArgs.data.completedAt as Date;
    expect(completedAt.getTime()).toBeGreaterThanOrEqual(beforeCall.getTime());

    expect(res.statusCode).toBe(200);
  });

  it("returns { cancelled: true }", async () => {
    const res = await injectCancel("run-xyz");
    const json = JSON.parse(res.body);

    expect(json).toEqual({ cancelled: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /run-scheduled
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /run-scheduled", () => {
  it("calls runScheduledRoute with correct ruleId and orgId", async () => {
    const mockResult = { runId: "run-1", recordsFound: 50, status: "RUNNING" };
    mockRunScheduledRoute.mockResolvedValue(mockResult);

    const res = await injectRunScheduled({ ruleId: "rule-42" }, "org-7");
    const json = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(mockRunScheduledRoute).toHaveBeenCalledWith("rule-42", "org-7", undefined);
    expect(json).toEqual(mockResult);
  });

  it("returns 400 when X-Org-Id header is missing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/run-scheduled",
      headers: { "content-type": "application/json" },
      payload: { ruleId: "rule-1" },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Missing X-Org-Id header");
  });

  it("returns 400 when ruleId is missing", async () => {
    const res = await injectRunScheduled({});

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe("Missing ruleId");
  });

  it("returns 500 when runScheduledRoute throws", async () => {
    mockRunScheduledRoute.mockRejectedValue(new Error("SFDC connection failed"));

    const res = await injectRunScheduled({ ruleId: "rule-1" });

    expect(res.statusCode).toBe(500);
    const json = JSON.parse(res.body);
    expect(json.error).toBe("Internal error");
    expect(json.detail).toBe("SFDC connection failed");
  });
});
