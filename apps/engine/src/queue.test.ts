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

const { mockEvictOrgConnection } = vi.hoisted(() => ({
  mockEvictOrgConnection: vi.fn(),
}));

vi.mock("./sfdc.js", () => ({
  getOrgConnection: vi.fn(),
  evictOrgConnection: mockEvictOrgConnection,
}));

const workerHandlers = vi.hoisted(() => new Map<string, Function>());

vi.mock("bullmq", () => {
  return {
    Queue: vi.fn().mockImplementation(() => ({
      add: mockQueueAdd,
    })),
    Worker: vi.fn().mockImplementation(() => ({
      on: vi.fn((event: string, handler: Function) => {
        workerHandlers.set(event, handler);
      }),
    })),
  };
});

import { enqueueRetry, type RetryJobData } from "./queue.js";
import { prisma } from "@lead-routing/db";

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

// ─── Worker "failed" handler ──────────────────────────────────────────────────

describe("routingWorker failed handler", () => {
  const makeJob = (overrides?: Partial<{ attemptsMade: number; data: RetryJobData }>) => ({
    data: {
      logId: "log-1",
      orgId: "org-1",
      recordId: "00Q000000000001",
      objectType: "Lead",
      ownerId: "005000000000001",
    },
    attemptsMade: 1,
    ...overrides,
  });

  it("evicts org connection on invalid_grant error", async () => {
    const failedHandler = workerHandlers.get("failed");
    expect(failedHandler).toBeDefined();

    await failedHandler!(makeJob(), new Error("invalid_grant: expired access/refresh token"));

    expect(mockEvictOrgConnection).toHaveBeenCalledWith("org-1");
  });

  it("evicts org connection on INVALID_SESSION_ID error", async () => {
    const failedHandler = workerHandlers.get("failed");

    await failedHandler!(makeJob(), new Error("INVALID_SESSION_ID: Session expired"));

    expect(mockEvictOrgConnection).toHaveBeenCalledWith("org-1");
  });

  it("evicts org connection on expired token error", async () => {
    const failedHandler = workerHandlers.get("failed");

    await failedHandler!(makeJob(), new Error("Token expired or revoked"));

    expect(mockEvictOrgConnection).toHaveBeenCalledWith("org-1");
  });

  it("does NOT evict on non-auth errors", async () => {
    const failedHandler = workerHandlers.get("failed");

    await failedHandler!(makeJob(), new Error("SFDC API rate limit exceeded"));

    expect(mockEvictOrgConnection).not.toHaveBeenCalled();
  });

  it("marks log as FAILED after 3 attempts", async () => {
    const failedHandler = workerHandlers.get("failed");
    (prisma.routingLog.update as any).mockResolvedValue({});

    await failedHandler!(makeJob({ attemptsMade: 3 }), new Error("Connection refused"));

    expect(prisma.routingLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: {
        status: "FAILED",
        errorMessage: "Connection refused",
        retryCount: 3,
      },
    });
  });

  it("does NOT mark as FAILED before 3 attempts", async () => {
    const failedHandler = workerHandlers.get("failed");

    await failedHandler!(makeJob({ attemptsMade: 2 }), new Error("Temporary error"));

    expect(prisma.routingLog.update).not.toHaveBeenCalled();
  });

  it("handles null job gracefully", async () => {
    const failedHandler = workerHandlers.get("failed");

    // Should not throw
    await failedHandler!(undefined, new Error("Unknown"));

    expect(mockEvictOrgConnection).not.toHaveBeenCalled();
    expect(prisma.routingLog.update).not.toHaveBeenCalled();
  });
});
