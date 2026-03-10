import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQueueAdd } = vi.hoisted(() => ({
  mockQueueAdd: vi.fn(),
}));

// Mock all heavy dependencies before they are imported at module level
vi.mock("./redis.js", () => ({
  redis: {},
}));

vi.mock("@lead-routing/db", () => ({
  prisma: {
    routingLog: { update: vi.fn() },
    organization: { update: vi.fn() },
  },
}));

vi.mock("@lead-routing/sfdc", () => ({
  updateOwner: vi.fn(),
}));

vi.mock("./sfdc.js", () => ({
  getOrgConnection: vi.fn(),
}));

vi.mock("bullmq", () => {
  return {
    Queue: vi.fn().mockImplementation(() => ({
      add: mockQueueAdd,
    })),
    Worker: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
    })),
  };
});

import { enqueueRetry, type RetryJobData } from "./queue.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── enqueueRetry ────────────────────────────────────────────────────────────

describe("enqueueRetry", () => {
  const jobData: RetryJobData = {
    logId: "log-1",
    orgId: "org-1",
    recordId: "00Q000000000001",
    objectType: "Lead",
    ownerId: "005000000000001",
  };

  it("adds a job to the queue with name 'sfdc-update'", async () => {
    mockQueueAdd.mockResolvedValue(undefined);
    await enqueueRetry(jobData);

    expect(mockQueueAdd).toHaveBeenCalledOnce();
    expect(mockQueueAdd).toHaveBeenCalledWith("sfdc-update", jobData);
  });

  it("passes the full RetryJobData as the job payload", async () => {
    mockQueueAdd.mockResolvedValue(undefined);
    await enqueueRetry(jobData);

    const [, data] = mockQueueAdd.mock.calls[0];
    expect(data).toEqual({
      logId: "log-1",
      orgId: "org-1",
      recordId: "00Q000000000001",
      objectType: "Lead",
      ownerId: "005000000000001",
    });
  });

  it("propagates errors from queue.add", async () => {
    mockQueueAdd.mockRejectedValue(new Error("Redis down"));
    await expect(enqueueRetry(jobData)).rejects.toThrow("Redis down");
  });
});
