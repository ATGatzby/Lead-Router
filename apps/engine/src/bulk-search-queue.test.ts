import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockBulkRouteRecords,
  mockRedisHincrby,
  mockRedisHset,
  mockBulkUpdateOwners,
  mockGetOrgConnection,
  mockGetOrgHubSpotClient,
  mockToCrmObjectType,
  mockPrismaRoutingLogUpdateMany,
  mockPrismaOrgFindUnique,
  capturedWorkerProcessor,
} = vi.hoisted(() => {
  const mockBulkRouteRecords = vi.fn().mockResolvedValue({
    assignments: [],
    routed: 0,
    failed: 0,
    unmatched: 0,
  });
  const mockRedisHincrby = vi.fn().mockResolvedValue(1);
  const mockRedisHset = vi.fn().mockResolvedValue(1);
  const mockBulkUpdateOwners = vi.fn().mockResolvedValue({
    successful: [],
    failed: [],
    unprocessed: 0,
  });
  const mockGetOrgConnection = vi.fn().mockResolvedValue({ /* mock jsforce conn */ });
  const mockGetOrgHubSpotClient = vi.fn().mockResolvedValue({ client: {}, crmApi: {} });
  const mockToCrmObjectType = vi.fn().mockReturnValue("contacts");
  const mockPrismaRoutingLogUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  const mockPrismaOrgFindUnique = vi.fn().mockResolvedValue({ crmType: "SALESFORCE" });

  const capturedWorkerProcessor: { fn: ((job: any) => Promise<any>) | null } = { fn: null };

  return {
    mockBulkRouteRecords,
    mockRedisHincrby,
    mockRedisHset,
    mockBulkUpdateOwners,
    mockGetOrgConnection,
    mockGetOrgHubSpotClient,
    mockToCrmObjectType,
    mockPrismaRoutingLogUpdateMany,
    mockPrismaOrgFindUnique,
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

vi.mock("./bulk-router.js", () => ({
  bulkRouteRecords: (...args: unknown[]) => mockBulkRouteRecords(...args),
}));

vi.mock("./router.js", () => ({
  routeRecord: vi.fn(),
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
    organization: {
      findUnique: mockPrismaOrgFindUnique,
    },
  },
}));

vi.mock("./hubspot-connection.js", () => ({
  getOrgHubSpotClient: mockGetOrgHubSpotClient,
  toCrmObjectType: mockToCrmObjectType,
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

describe("bulk search worker — Phase A: bulk route evaluation", () => {
  it("calls bulkRouteRecords once with all records", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [],
      routed: 0,
      failed: 0,
      unmatched: 2,
    });

    const processor = getWorkerProcessor();
    await processor(makeJob());

    expect(mockBulkRouteRecords).toHaveBeenCalledTimes(1);

    const input = mockBulkRouteRecords.mock.calls[0][0];
    expect(input.orgId).toBe("org-1");
    expect(input.ruleId).toBe("rule-1");
    expect(input.runId).toBe("run-123");
    expect(input.objectType).toBe("LEAD");
    expect(input.records).toHaveLength(2);
    expect(input.records[0].recordId).toBe("00Q000001");
    expect(input.records[1].recordId).toBe("00Q000002");
  });

  it("passes only recordId and fields to bulkRouteRecords (no matchResult)", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [],
      routed: 0,
      failed: 0,
      unmatched: 2,
    });

    const processor = getWorkerProcessor();
    await processor(makeJob());

    const input = mockBulkRouteRecords.mock.calls[0][0];
    // bulkRouteRecords receives records with recordId and fields only
    expect(input.records[0]).toEqual({
      recordId: "00Q000001",
      fields: { Email: "a@test.com", Company: "Acme" },
    });
    expect(input.records[1]).toEqual({
      recordId: "00Q000002",
      fields: { Email: "b@test.com", Company: "Beta" },
    });
  });

  it("forwards assignments from bulkRouteRecords to Phase B", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: "User A", assignmentType: "USER", teamId: null, teamName: null },
        { recordId: "00Q000002", ownerId: "005OWNER2", logId: "log-2", assigneeName: "User B", assignmentType: "USER", teamId: null, teamName: null },
      ],
      routed: 2,
      failed: 0,
      unmatched: 0,
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000001", "00Q000002"],
      failed: [],
      unprocessed: 0,
    });

    const processor = getWorkerProcessor();
    await processor(makeJob());

    // bulkUpdateOwners should have been called with the assignments
    expect(mockBulkUpdateOwners).toHaveBeenCalledTimes(1);
    const [_conn, objectType, records, routingActionField] = mockBulkUpdateOwners.mock.calls[0];
    expect(objectType).toBe("Lead"); // toSfdcObjectName maps LEAD → Lead
    expect(records).toHaveLength(2);
    expect(records[0].Id).toBe("00Q000001");
    expect(records[0].OwnerId).toBe("005OWNER");
    expect(records[1].Id).toBe("00Q000002");
    expect(records[1].OwnerId).toBe("005OWNER2");
    expect(routingActionField).toBe("lrt__Routing_Action__c");
  });
});

describe("bulk search worker — Phase B: bulk write", () => {
  it("calls bulkUpdateOwners with collected records", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
        { recordId: "00Q000002", ownerId: "005OWNER", logId: "log-2", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
      ],
      routed: 2,
      failed: 0,
      unmatched: 0,
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
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
      ],
      routed: 1,
      failed: 0,
      unmatched: 1,
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

  it("updates logs to SUCCESS for successful bulk writes with assignee data", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: "User A", assignmentType: "USER", teamId: null, teamName: null },
        { recordId: "00Q000002", ownerId: "005OWNER", logId: "log-2", assigneeName: "User A", assignmentType: "USER", teamId: null, teamName: null },
      ],
      routed: 2,
      failed: 0,
      unmatched: 0,
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000001", "00Q000002"],
      failed: [],
      unprocessed: 0,
    });

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    // Grouped by assignee — both have same assignee so one updateMany call
    expect(mockPrismaRoutingLogUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["log-1", "log-2"] } },
      data: {
        status: "SUCCESS",
        assigneeId: "005OWNER",
        assigneeName: "User A",
        assignmentType: "USER",
        teamId: null,
        teamName: null,
      },
    });
    expect(result.routed).toBe(2);
    expect(result.failed).toBe(0);
  });

  it("updates logs to FAILED for failed bulk writes", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: "User A", assignmentType: "USER", teamId: null, teamName: null },
        { recordId: "00Q000002", ownerId: "005OWNER2", logId: "log-2", assigneeName: "User B", assignmentType: "USER", teamId: null, teamName: null },
      ],
      routed: 2,
      failed: 0,
      unmatched: 0,
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
      where: { id: { in: ["log-1"] } },
      data: {
        status: "SUCCESS",
        assigneeId: "005OWNER",
        assigneeName: "User A",
        assignmentType: "USER",
        teamId: null,
        teamName: null,
      },
    });

    // FAILED call for 00Q000002
    expect(mockPrismaRoutingLogUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["log-2"] } },
      data: { status: "FAILED", errorMessage: "Bulk API write failed" },
    });

    expect(result.routed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("marks all assignments as FAILED when bulkUpdateOwners throws", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
        { recordId: "00Q000002", ownerId: "005OWNER", logId: "log-2", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
      ],
      routed: 2,
      failed: 0,
      unmatched: 0,
    });

    mockBulkUpdateOwners.mockRejectedValue(new Error("Connection timeout"));

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    expect(mockPrismaRoutingLogUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ["log-1", "log-2"] } },
      data: { status: "FAILED", errorMessage: "Bulk write error: Connection timeout" },
    });

    expect(result.routed).toBe(0);
    expect(result.failed).toBe(2);

    errorSpy.mockRestore();
  });

  it("counts unprocessed records as failed", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
        { recordId: "00Q000002", ownerId: "005OWNER", logId: "log-2", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
      ],
      routed: 2,
      failed: 0,
      unmatched: 0,
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

  it("does not call bulkUpdateOwners when no assignments returned", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [],
      routed: 0,
      failed: 0,
      unmatched: 2,
    });

    const processor = getWorkerProcessor();
    await processor(makeJob());

    expect(mockBulkUpdateOwners).not.toHaveBeenCalled();
  });

  it("skips SFDC write for records where owner is already correct", async () => {
    // Record 00Q000001 has OwnerId "005OWNER" in fields, and assignment gives same owner
    // Record 00Q000002 has OwnerId "005OTHER" in fields, and assignment gives "005OWNER" (different)
    const job = makeJob({
      records: [
        {
          recordId: "00Q000001",
          fields: { Email: "a@test.com", OwnerId: "005OWNER" },
          matchResult: null,
        },
        {
          recordId: "00Q000002",
          fields: { Email: "b@test.com", OwnerId: "005OTHER" },
          matchResult: null,
        },
      ],
    });

    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: "User A", assignmentType: "USER", teamId: null, teamName: null },
        { recordId: "00Q000002", ownerId: "005OWNER", logId: "log-2", assigneeName: "User A", assignmentType: "USER", teamId: null, teamName: null },
      ],
      routed: 2,
      failed: 0,
      unmatched: 0,
    });

    mockBulkUpdateOwners.mockResolvedValue({
      successful: ["00Q000002"],
      failed: [],
      unprocessed: 0,
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const processor = getWorkerProcessor();
    const result = await processor(job);

    // Only 00Q000002 should be sent to bulkUpdateOwners (owner changed)
    const [_conn, _objType, updateRecords] = mockBulkUpdateOwners.mock.calls[0];
    expect(updateRecords).toHaveLength(1);
    expect(updateRecords[0].Id).toBe("00Q000002");

    // Both should count as routed (one skipped, one written)
    expect(result.routed).toBe(2);
    expect(result.failed).toBe(0);

    logSpy.mockRestore();
  });
});

describe("bulk search worker — Phase C: Redis counters", () => {
  it("increments routed counter based on bulk write results", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
        { recordId: "00Q000002", ownerId: "005OWNER", logId: "log-2", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
      ],
      routed: 2,
      failed: 0,
      unmatched: 0,
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
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
        { recordId: "00Q000002", ownerId: "005OWNER", logId: "log-2", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
      ],
      routed: 2,
      failed: 0,
      unmatched: 0,
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

  it("increments failed counter when bulkRouteRecords returns failures", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [],
      routed: 0,
      failed: 2,
      unmatched: 0,
    });

    const processor = getWorkerProcessor();
    const result = await processor(makeJob());

    expect(result.failed).toBe(2);
    expect(result.routed).toBe(0);
    expect(mockRedisHincrby).toHaveBeenCalledWith("bulk-run:run-123", "failed", 2);
  });

  it("skips hincrby when count is zero", async () => {
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [],
      routed: 0,
      failed: 0,
      unmatched: 2,
    });

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
    mockBulkRouteRecords.mockResolvedValue({
      assignments: [
        { recordId: "00Q000001", ownerId: "005OWNER", logId: "log-1", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
        { recordId: "00Q000002", ownerId: "005OWNER2", logId: "log-2", assigneeName: null, assignmentType: null, teamId: null, teamName: null },
      ],
      routed: 2,
      failed: 0,
      unmatched: 0,
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

describe("bulk search worker — simulation mode", () => {
  it("skips routing and SFDC, just counts records", async () => {
    const processor = getWorkerProcessor();
    const result = await processor(makeJob({ simulate: true }));

    expect(result.routed).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockBulkRouteRecords).not.toHaveBeenCalled();
    expect(mockBulkUpdateOwners).not.toHaveBeenCalled();
    expect(mockRedisHincrby).toHaveBeenCalledWith("bulk-run:run-123", "routed", 2);
  });
});
