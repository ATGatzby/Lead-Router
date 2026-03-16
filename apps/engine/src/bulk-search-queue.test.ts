import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockRouteRecord,
  mockRedisHincrby,
  mockRedisHset,
  mockBulkUpdateOwners,
  mockGetOrgConnection,
  mockPrismaRoutingLogUpdateMany,
  capturedWorkerProcessor,
} = vi.hoisted(() => {
  const mockRouteRecord = vi.fn().mockResolvedValue("routed");
  const mockRedisHincrby = vi.fn().mockResolvedValue(1);
  const mockRedisHset = vi.fn().mockResolvedValue(1);
  const mockBulkUpdateOwners = vi.fn().mockResolvedValue({
    successful: [],
    failed: [],
    unprocessed: 0,
  });
  const mockGetOrgConnection = vi.fn().mockResolvedValue({ /* mock jsforce conn */ });
  const mockPrismaRoutingLogUpdateMany = vi.fn().mockResolvedValue({ count: 0 });

  const capturedWorkerProcessor: { fn: ((job: any) => Promise<any>) | null } = { fn: null };

  return {
    mockRouteRecord,
    mockRedisHincrby,
    mockRedisHset,
    mockBulkUpdateOwners,
    mockGetOrgConnection,
    mockPrismaRoutingLogUpdateMany,
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
    hset: mockRedisHset,
  })),
}));

vi.mock("./router.js", () => ({
  routeRecord: mockRouteRecord,
}));

vi.mock("./sfdc.js", () => ({
  getOrgConnection: mockGetOrgConnection,
}));

vi.mock("@lead-routing/sfdc", () => ({
  bulkUpdateOwners: mockBulkUpdateOwners,
}));

vi.mock("@lead-routing/db", () => ({
  prisma: {
    routingLog: {
      updateMany: mockPrismaRoutingLogUpdateMany,
    },
  },
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

describe("bulk search worker — Phase A: collect routing decisions", () => {
  it("calls routeRecord for each record with skipSfdcWrite and _assignments", async () => {
    mockRouteRecord.mockResolvedValue("routed");

    const processor = getWorkerProcessor();
    await processor(makeJob());

    expect(mockRouteRecord).toHaveBeenCalledTimes(2);

    // Check skipSfdcWrite is set
    const firstPayload = mockRouteRecord.mock.calls[0][0];
    expect(firstPayload.skipSfdcWrite).toBe(true);
    expect(firstPayload._assignments).toBeDefined();
    expect(Array.isArray(firstPayload._assignments)).toBe(true);
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

  it("collects assignments via the shared _assignments array", async () => {
    // Simulate routeRecord pushing to _assignments
    mockRouteRecord.mockImplementation(async (payload: any) => {
      payload._assignments?.push({
        recordId: payload.recordId,
        ownerId: "005OWNER",
        logId: `log-${payload.recordId}`,
      });
      return "routed";
    });

    // Mock bulkUpdateOwners to return all successful
    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000001", "00Q000002"],
      failed: [],
      unprocessed: 0,
    });

    const processor = getWorkerProcessor();
    await processor(makeJob());

    // bulkUpdateOwners should have been called with the collected assignments
    expect(mockBulkUpdateOwners).toHaveBeenCalledTimes(1);
    const [_conn, objectType, records, routingActionField] = mockBulkUpdateOwners.mock.calls[0];
    expect(objectType).toBe("Lead"); // toSfdcObjectName maps LEAD → Lead
    expect(records).toHaveLength(2);
    expect(records[0].Id).toBe("00Q000001");
    expect(records[0].OwnerId).toBe("005OWNER");
    expect(routingActionField).toBe("lrt__Routing_Action__c");
  });
});

describe("bulk search worker — Phase B: bulk write", () => {
  it("calls bulkUpdateOwners with collected records", async () => {
    mockRouteRecord.mockImplementation(async (payload: any) => {
      payload._assignments?.push({
        recordId: payload.recordId,
        ownerId: "005OWNER",
        logId: `log-${payload.recordId}`,
      });
      return "routed";
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000001", "00Q000002"],
      failed: [],
      unprocessed: 0,
    });

    const processor = getWorkerProcessor();
    await processor(makeJob());

    expect(mockGetOrgConnection).toHaveBeenCalledWith("org-1");
    expect(mockBulkUpdateOwners).toHaveBeenCalledTimes(1);
  });

  it("sets phase to 'writing' in Redis before bulk write", async () => {
    mockRouteRecord.mockImplementation(async (payload: any) => {
      payload._assignments?.push({
        recordId: payload.recordId,
        ownerId: "005OWNER",
        logId: `log-${payload.recordId}`,
      });
      return "routed";
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000001"],
      failed: [],
      unprocessed: 0,
    });

    const processor = getWorkerProcessor();
    await processor(makeJob());

    expect(mockRedisHset).toHaveBeenCalledWith("bulk-run:run-123", "phase", "writing");
  });

  it("updates logs to SUCCESS for successful bulk writes", async () => {
    mockRouteRecord.mockImplementation(async (payload: any) => {
      payload._assignments?.push({
        recordId: payload.recordId,
        ownerId: "005OWNER",
        logId: `log-${payload.recordId}`,
      });
      return "routed";
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000001", "00Q000002"],
      failed: [],
      unprocessed: 0,
    });

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    expect(mockPrismaRoutingLogUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["log-00Q000001", "log-00Q000002"] } },
      data: { status: "SUCCESS" },
    });
    expect(result.routed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("updates logs to FAILED for failed bulk writes", async () => {
    mockRouteRecord.mockImplementation(async (payload: any) => {
      payload._assignments?.push({
        recordId: payload.recordId,
        ownerId: "005OWNER",
        logId: `log-${payload.recordId}`,
      });
      return "routed";
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000001"],
      failed: [{ id: "00Q000002", error: "INSUFFICIENT_ACCESS" }],
      unprocessed: 0,
    });

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    // SUCCESS call for 00Q000001
    expect(mockPrismaRoutingLogUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["log-00Q000001"] } },
      data: { status: "SUCCESS" },
    });

    // FAILED call for 00Q000002
    expect(mockPrismaRoutingLogUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["log-00Q000002"] } },
      data: { status: "FAILED", errorMessage: "Bulk API write failed" },
    });

    expect(result.routed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("marks all assignments as FAILED when bulkUpdateOwners throws", async () => {
    mockRouteRecord.mockImplementation(async (payload: any) => {
      payload._assignments?.push({
        recordId: payload.recordId,
        ownerId: "005OWNER",
        logId: `log-${payload.recordId}`,
      });
      return "routed";
    });

    mockBulkUpdateOwners.mockRejectedValue(new Error("Connection timeout"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    expect(mockPrismaRoutingLogUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["log-00Q000001", "log-00Q000002"] } },
      data: { status: "FAILED", errorMessage: "Bulk write error: Connection timeout" },
    });

    expect(result.routed).toBe(0);
    expect(result.failed).toBe(2);

    errorSpy.mockRestore();
  });

  it("counts unprocessed records as failed", async () => {
    mockRouteRecord.mockImplementation(async (payload: any) => {
      payload._assignments?.push({
        recordId: payload.recordId,
        ownerId: "005OWNER",
        logId: `log-${payload.recordId}`,
      });
      return "routed";
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000001"],
      failed: [],
      unprocessed: 1,
    });

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    expect(result.routed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("does not call bulkUpdateOwners when no assignments collected", async () => {
    // routeRecord returns "routed" but doesn't push to _assignments
    mockRouteRecord.mockResolvedValue("unmatched");

    const processor = getWorkerProcessor();
    await processor(makeJob());

    expect(mockBulkUpdateOwners).not.toHaveBeenCalled();
  });
});

describe("bulk search worker — Phase C: Redis counters", () => {
  it("increments routed counter based on bulk write results", async () => {
    mockRouteRecord.mockImplementation(async (payload: any) => {
      payload._assignments?.push({
        recordId: payload.recordId,
        ownerId: "005OWNER",
        logId: `log-${payload.recordId}`,
      });
      return "routed";
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000001", "00Q000002"],
      failed: [],
      unprocessed: 0,
    });

    const processor = getWorkerProcessor();
    await processor(makeJob());

    expect(mockRedisHincrby).toHaveBeenCalledWith("bulk-run:run-123", "routed", 2);
  });

  it("increments failed counter for failed bulk writes", async () => {
    mockRouteRecord.mockImplementation(async (payload: any) => {
      payload._assignments?.push({
        recordId: payload.recordId,
        ownerId: "005OWNER",
        logId: `log-${payload.recordId}`,
      });
      return "routed";
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: [],
      failed: [
        { id: "00Q000001", error: "ERR" },
        { id: "00Q000002", error: "ERR" },
      ],
      unprocessed: 0,
    });

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

  it("skips hincrby when count is zero", async () => {
    mockRouteRecord.mockResolvedValue("routed");
    // No assignments pushed, so no bulk write, routed stays 0

    const processor = getWorkerProcessor();
    await processor(makeJob());

    // No routed or failed calls since nothing happened
    const routedCall = mockRedisHincrby.mock.calls.find(
      (call: any[]) => call[1] === "routed"
    );
    const failedCall = mockRedisHincrby.mock.calls.find(
      (call: any[]) => call[1] === "failed"
    );
    expect(routedCall).toBeUndefined();
    expect(failedCall).toBeUndefined();
  });

  it("reflects mixed bulk write results in Redis counters", async () => {
    mockRouteRecord.mockImplementation(async (payload: any) => {
      payload._assignments?.push({
        recordId: payload.recordId,
        ownerId: "005OWNER",
        logId: `log-${payload.recordId}`,
      });
      return "routed";
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000001"],
      failed: [{ id: "00Q000002", error: "ERR" }],
      unprocessed: 0,
    });

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    expect(result.routed).toBe(1);
    expect(result.failed).toBe(1);
    expect(mockRedisHincrby).toHaveBeenCalledWith("bulk-run:run-123", "routed", 1);
    expect(mockRedisHincrby).toHaveBeenCalledWith("bulk-run:run-123", "failed", 1);
  });
});
