import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────

const { mockAddBulk, mockOn } = vi.hoisted(() => ({
  mockAddBulk: vi.fn().mockResolvedValue([]),
  mockOn: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    addBulk: mockAddBulk,
  })),
  Worker: vi.fn().mockImplementation(() => ({
    on: mockOn,
  })),
}));

vi.mock("./redis.js", () => ({
  redis: {},
}));

vi.mock("@lead-routing/db", () => ({
  prisma: {
    organization: {
      update: vi.fn(),
    },
  },
}));

vi.mock("./router.js", () => ({
  routeRecord: vi.fn().mockResolvedValue("routed"),
}));

import { enqueueBatchJobs, type BatchJobData } from "./batch-queue.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────

describe("enqueueBatchJobs", () => {
  it("enqueues all jobs via addBulk", async () => {
    const jobs: BatchJobData[] = [
      {
        orgId: "org1",
        objectType: "LEAD",
        eventType: "INSERT",
        recordId: "rec1",
        timestamp: "2026-01-01T00:00:00Z",
        fields: { Email: "a@b.com" },
        batchId: "batch-1",
      },
      {
        orgId: "org1",
        objectType: "LEAD",
        eventType: "INSERT",
        recordId: "rec2",
        timestamp: "2026-01-01T00:00:00Z",
        fields: { Email: "c@d.com" },
        batchId: "batch-1",
      },
    ];

    await enqueueBatchJobs(jobs);

    expect(mockAddBulk).toHaveBeenCalledTimes(1);
    const bulkArg = mockAddBulk.mock.calls[0][0];
    expect(bulkArg).toHaveLength(2);
    expect(bulkArg[0]).toEqual({ name: "route-record", data: jobs[0] });
    expect(bulkArg[1]).toEqual({ name: "route-record", data: jobs[1] });
  });

  it("handles empty array", async () => {
    await enqueueBatchJobs([]);
    expect(mockAddBulk).toHaveBeenCalledWith([]);
  });
});
