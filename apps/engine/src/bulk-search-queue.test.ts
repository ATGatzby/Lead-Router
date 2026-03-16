import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockRouteRecord,
  mockRedisHincrby,
  capturedWorkerProcessor,
} = vi.hoisted(() => {
  const mockRouteRecord = vi.fn().mockResolvedValue("routed");
  const mockRedisHincrby = vi.fn().mockResolvedValue(1);

  const capturedWorkerProcessor: { fn: ((job: any) => Promise<any>) | null } = { fn: null };

  return {
    mockRouteRecord,
    mockRedisHincrby,
    capturedWorkerProcessor,
  };
});

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue(undefined),
    addBulk: vi.fn().mockResolvedValue([]),
  })),
  Worker: vi.fn().mockImplementation((_name: string, processor: any) => {
    capturedWorkerProcessor.fn = processor;
    return { on: vi.fn() };
  }),
}));

vi.mock("ioredis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    hincrby: mockRedisHincrby,
  })),
}));

vi.mock("./router.js", () => ({
  routeRecord: mockRouteRecord,
}));

// ─── Import after mocks ────────────────────────────────────────────────────

import { initBulkSearchQueue } from "./bulk-search-queue.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getWorkerProcessor(): (job: any) => Promise<any> {
  if (!capturedWorkerProcessor.fn) {
    throw new Error("Worker processor was not captured — did initBulkSearchQueue run?");
  }
  return capturedWorkerProcessor.fn;
}

function makeJob(overrides: Partial<any> = {}) {
  return {
    data: {
      orgId: "org-1",
      ruleId: "rule-1",
      runId: "run-123",
      objectType: "LEAD",
      records: [
        {
          recordId: "00Q000001",
          fields: { Email: "a@test.com", Company: "Acme" },
          matchResult: {
            matchedType: "ACCOUNT",
            matchedRecordId: "001ABC",
            ownerId: "005XYZ",
            matchField: "Company",
          },
        },
        {
          recordId: "00Q000002",
          fields: { Email: "b@test.com", Company: "Beta" },
          matchResult: null,
        },
      ],
      ...overrides,
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  initBulkSearchQueue("redis://localhost:6379");
});

describe("bulk search worker — processes records", () => {
  it("calls routeRecord for each record in the job", async () => {
    mockRouteRecord.mockResolvedValue("routed");

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    expect(mockRouteRecord).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ routed: 2, failed: 0 });
  });

  it("passes preResolvedMatch from matchResult", async () => {
    mockRouteRecord.mockResolvedValue("routed");

    const processor = getWorkerProcessor();
    await processor(makeJob());

    // First call — has matchResult
    const firstPayload = mockRouteRecord.mock.calls[0][0];
    expect(firstPayload.preResolvedMatch).toEqual({
      type: "ACCOUNT",
      ownerId: "005XYZ",
      recordId: "001ABC",
    });

    // Second call — null matchResult
    const secondPayload = mockRouteRecord.mock.calls[1][0];
    expect(secondPayload.preResolvedMatch).toBeNull();
  });

  it("sets eventType to SEARCH and includes ruleId", async () => {
    mockRouteRecord.mockResolvedValue("routed");

    const processor = getWorkerProcessor();
    await processor(makeJob());

    const payload = mockRouteRecord.mock.calls[0][0];
    expect(payload.eventType).toBe("SEARCH");
    expect(payload.ruleId).toBe("rule-1");
    expect(payload.orgId).toBe("org-1");
    expect(payload.objectType).toBe("LEAD");
  });
});

describe("bulk search worker — Redis counters", () => {
  it("increments routed counter when records are routed", async () => {
    mockRouteRecord.mockResolvedValue("routed");

    const processor = getWorkerProcessor();
    await processor(makeJob());

    expect(mockRedisHincrby).toHaveBeenCalledWith("bulk-run:run-123", "routed", 2);
  });

  it("increments failed counter for unmatched results", async () => {
    mockRouteRecord.mockResolvedValue("unmatched");

    const processor = getWorkerProcessor();
    await processor(makeJob());

    expect(mockRedisHincrby).toHaveBeenCalledWith("bulk-run:run-123", "failed", 2);
    // Should not increment routed
    const routedCall = mockRedisHincrby.mock.calls.find(
      (call: any[]) => call[1] === "routed"
    );
    expect(routedCall).toBeUndefined();
  });

  it("increments failed counter when routeRecord throws", async () => {
    mockRouteRecord.mockRejectedValue(new Error("DB connection lost"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    expect(result.failed).toBe(2);
    expect(result.routed).toBe(0);
    expect(mockRedisHincrby).toHaveBeenCalledWith("bulk-run:run-123", "failed", 2);

    errorSpy.mockRestore();
  });

  it("counts merged results as routed", async () => {
    mockRouteRecord.mockResolvedValue("merged");

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    expect(result.routed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("handles mixed results correctly", async () => {
    mockRouteRecord
      .mockResolvedValueOnce("routed")
      .mockResolvedValueOnce("unmatched");

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    expect(result.routed).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockRedisHincrby).toHaveBeenCalledWith("bulk-run:run-123", "routed", 1);
    expect(mockRedisHincrby).toHaveBeenCalledWith("bulk-run:run-123", "failed", 1);
  });

  it("skips hincrby when count is zero", async () => {
    mockRouteRecord.mockResolvedValue("routed");

    const processor = getWorkerProcessor();
    await processor(makeJob());

    // Only routed should be called, not failed (since failed=0)
    const failedCall = mockRedisHincrby.mock.calls.find(
      (call: any[]) => call[1] === "failed"
    );
    expect(failedCall).toBeUndefined();
  });
});
