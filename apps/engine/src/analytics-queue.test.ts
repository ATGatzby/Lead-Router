import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockQueueAdd,
  mockGetRepeatableJobs,
  mockRemoveRepeatableByKey,
  mockPrisma,
  mockSfQuery,
  mockGetOrgConnection,
  capturedWorkerProcessor,
} = vi.hoisted(() => {
  const mockQueueAdd = vi.fn().mockResolvedValue(undefined);
  const mockGetRepeatableJobs = vi.fn().mockResolvedValue([]);
  const mockRemoveRepeatableByKey = vi.fn().mockResolvedValue(undefined);

  const mockPrisma = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  };

  const mockSfQuery = vi.fn().mockResolvedValue({ records: [] });
  const mockGetOrgConnection = vi.fn().mockResolvedValue({ query: mockSfQuery });

  // Will hold a reference to the processor function passed to new Worker(name, processor, opts)
  const capturedWorkerProcessor: { fn: ((job: any) => Promise<void>) | null } = { fn: null };

  return {
    mockQueueAdd,
    mockGetRepeatableJobs,
    mockRemoveRepeatableByKey,
    mockPrisma,
    mockSfQuery,
    mockGetOrgConnection,
    capturedWorkerProcessor,
  };
});

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    getRepeatableJobs: mockGetRepeatableJobs,
    removeRepeatableByKey: mockRemoveRepeatableByKey,
  })),
  Worker: vi.fn().mockImplementation((_name: string, processor: any) => {
    capturedWorkerProcessor.fn = processor;
    return { on: vi.fn() };
  }),
}));

vi.mock("ioredis", () => ({
  Redis: vi.fn(),
  default: vi.fn(),
}));

vi.mock("./redis.js", () => ({
  redis: {},
  getRedis: vi.fn(() => ({})),
}));

vi.mock("@lead-routing/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("./sfdc.js", () => ({
  getOrgConnection: mockGetOrgConnection,
}));

// ─── Import after mocks ────────────────────────────────────────────────────

import { analyticsQueue, enqueueReconciliation, enqueueConversionCheck } from "./analytics-queue.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

function getWorkerProcessor(): (job: { name: string; data?: Record<string, unknown> }) => Promise<void> {
  if (!capturedWorkerProcessor.fn) {
    throw new Error("Worker processor was not captured — did the module load correctly?");
  }
  return capturedWorkerProcessor.fn;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("enqueueReconciliation", () => {
  it("calls queue.add with manual-reconciliation job name", async () => {
    await enqueueReconciliation();
    expect(mockQueueAdd).toHaveBeenCalledWith("manual-reconciliation", {
      date: undefined,
    });
  });

  it("passes the date as ISO string when provided", async () => {
    const date = new Date("2026-01-15T00:00:00.000Z");
    await enqueueReconciliation(date);
    expect(mockQueueAdd).toHaveBeenCalledWith("manual-reconciliation", {
      date: "2026-01-15T00:00:00.000Z",
    });
  });
});

describe("enqueueConversionCheck", () => {
  it("calls queue.add with manual-conversion-check job name", async () => {
    await enqueueConversionCheck();
    expect(mockQueueAdd).toHaveBeenCalledWith("manual-conversion-check", {});
  });
});

describe("analyticsQueue", () => {
  it("is created as a Queue instance", () => {
    expect(analyticsQueue).toBeDefined();
    expect(analyticsQueue.add).toBeDefined();
  });
});

describe("worker processor — reconciliation", () => {
  it("deletes old aggregates and recomputes for each org", async () => {
    const processor = getWorkerProcessor();

    // Mock: two orgs had routing activity on that date
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { orgId: "org-1" },
      { orgId: "org-2" },
    ]);

    await processor({
      name: "nightly-reconciliation",
      data: { date: "2026-01-10T00:00:00.000Z" },
    });

    // Should query for orgs with activity on that date
    expect(mockPrisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SELECT DISTINCT "orgId" FROM routing_logs'),
      expect.any(Date),
      expect.any(Date),
    );

    // Should delete + 5 inserts for each org (6 calls per org = 12)
    const executeRawCalls = mockPrisma.$executeRawUnsafe.mock.calls;
    expect(executeRawCalls.length).toBe(12);

    // First org: delete then 5 dimension-level inserts
    expect(executeRawCalls[0][0]).toContain("DELETE FROM routing_daily_aggregates");
    expect(executeRawCalls[0][1]).toBe("org-1");
    expect(executeRawCalls[1][0]).toContain("INSERT INTO routing_daily_aggregates");
    expect(executeRawCalls[1][1]).toBe("org-1");

    // Second org starts at index 6
    expect(executeRawCalls[6][0]).toContain("DELETE FROM routing_daily_aggregates");
    expect(executeRawCalls[6][1]).toBe("org-2");
    expect(executeRawCalls[7][0]).toContain("INSERT INTO routing_daily_aggregates");
    expect(executeRawCalls[7][1]).toBe("org-2");
  });

  it("defaults to yesterday when no date is provided", async () => {
    const processor = getWorkerProcessor();
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

    await processor({ name: "manual-reconciliation", data: {} });

    const [, targetDate] = mockPrisma.$queryRawUnsafe.mock.calls[0];
    const yesterday = new Date(Date.now() - 86400000);
    yesterday.setUTCHours(0, 0, 0, 0);
    expect((targetDate as Date).toISOString()).toBe(yesterday.toISOString());
  });

  it("skips processing when no orgs have activity", async () => {
    const processor = getWorkerProcessor();
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([]);

    await processor({ name: "nightly-reconciliation", data: {} });

    expect(mockPrisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe("worker processor — conversion check", () => {
  it("queries SFDC for converted leads and updates tracking rows", async () => {
    const processor = getWorkerProcessor();

    // Step 1: orgs with unconverted leads
    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ orgId: "org-A" }])
      // Step 2b: unconverted leads for org-A
      .mockResolvedValueOnce([
        { id: "ct-1", sfdcLeadId: "00Q0001" },
        { id: "ct-2", sfdcLeadId: "00Q0002" },
      ]);

    // SFDC Lead query: one converted, one not
    mockSfQuery.mockResolvedValueOnce({
      records: [
        {
          Id: "00Q0001",
          IsConverted: true,
          ConvertedDate: "2026-02-01",
          ConvertedOpportunityId: "006ABC",
        },
      ],
    });

    // SFDC Opportunity query for the converted lead
    mockSfQuery.mockResolvedValueOnce({
      records: [
        { Id: "006ABC", Amount: 50000, StageName: "Closed Won" },
      ],
    });

    await processor({ name: "conversion-check", data: {} });

    // Should get SFDC connection for org-A
    expect(mockGetOrgConnection).toHaveBeenCalledWith("org-A");

    // Should query leads with IN clause
    const leadQuery = mockSfQuery.mock.calls[0][0] as string;
    expect(leadQuery).toContain("SELECT Id, IsConverted, ConvertedDate, ConvertedOpportunityId FROM Lead");
    expect(leadQuery).toContain("'00Q0001'");
    expect(leadQuery).toContain("'00Q0002'");

    // Should query opportunity details
    const oppQuery = mockSfQuery.mock.calls[1][0] as string;
    expect(oppQuery).toContain("SELECT Id, Amount, StageName FROM Opportunity");
    expect(oppQuery).toContain("006ABC");

    // Should update the converted tracking row
    const updateCalls = mockPrisma.$executeRawUnsafe.mock.calls;
    const conversionUpdate = updateCalls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes('"isConverted" = true')
    );
    expect(conversionUpdate).toBeDefined();
    expect(conversionUpdate![4]).toBe("Closed Won"); // oppStageName
    expect(conversionUpdate![5]).toBe("ct-1"); // trackingId

    // Should update lastCheckedAt for remaining non-converted rows
    const lastCheckedUpdate = updateCalls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes('"lastCheckedAt" = NOW() WHERE "orgId"')
    );
    expect(lastCheckedUpdate).toBeDefined();
    expect(lastCheckedUpdate![1]).toBe("org-A");
  });

  it("skips org when no unconverted leads exist", async () => {
    const processor = getWorkerProcessor();

    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ orgId: "org-B" }])
      .mockResolvedValueOnce([]); // no rows for org-B

    await processor({ name: "conversion-check", data: {} });

    // Should still get connection, but not query SFDC
    expect(mockGetOrgConnection).toHaveBeenCalledWith("org-B");
    expect(mockSfQuery).not.toHaveBeenCalled();
  });

  it("continues to next org when SFDC connection fails", async () => {
    const processor = getWorkerProcessor();

    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { orgId: "org-fail" },
      { orgId: "org-ok" },
    ]);

    // First org fails on connection
    mockGetOrgConnection
      .mockRejectedValueOnce(new Error("SFDC auth failed"))
      // Second org succeeds
      .mockResolvedValueOnce({ query: mockSfQuery });

    // Second org: has leads
    mockPrisma.$queryRawUnsafe.mockResolvedValueOnce([
      { id: "ct-10", sfdcLeadId: "00Q0010" },
    ]);

    // SFDC returns no conversions for second org
    mockSfQuery.mockResolvedValueOnce({ records: [] });

    await processor({ name: "manual-conversion-check", data: {} });

    // Should have attempted both orgs
    expect(mockGetOrgConnection).toHaveBeenCalledTimes(2);
    expect(mockGetOrgConnection).toHaveBeenCalledWith("org-fail");
    expect(mockGetOrgConnection).toHaveBeenCalledWith("org-ok");
  });

  it("handles converted lead without opportunity gracefully", async () => {
    const processor = getWorkerProcessor();

    mockPrisma.$queryRawUnsafe
      .mockResolvedValueOnce([{ orgId: "org-C" }])
      .mockResolvedValueOnce([{ id: "ct-5", sfdcLeadId: "00Q0005" }]);

    // Lead is converted but no opportunity
    mockSfQuery.mockResolvedValueOnce({
      records: [
        {
          Id: "00Q0005",
          IsConverted: true,
          ConvertedDate: "2026-03-01",
          ConvertedOpportunityId: null,
        },
      ],
    });

    await processor({ name: "conversion-check", data: {} });

    // Should NOT query opportunity
    expect(mockSfQuery).toHaveBeenCalledTimes(1);

    // Should still update the conversion row with null opp fields
    const updateCall = mockPrisma.$executeRawUnsafe.mock.calls.find(
      (call: unknown[]) => typeof call[0] === "string" && call[0].includes('"isConverted" = true')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![2]).toBeNull(); // opportunity_id
    expect(updateCall![3]).toBeNull(); // opportunity_amount
    expect(updateCall![4]).toBeNull(); // opportunity_stage_name
  });
});

describe("worker processor — unknown job name", () => {
  it("logs a warning and does nothing", async () => {
    const processor = getWorkerProcessor();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await processor({ name: "unknown-job", data: {} });

    expect(warnSpy).toHaveBeenCalledWith(
      "[analytics] Unknown job name: unknown-job"
    );
    warnSpy.mockRestore();
  });
});
