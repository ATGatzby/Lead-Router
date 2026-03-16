import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ─── Mocks (vi.mock factories cannot reference outer variables) ──────────

vi.mock("./redis.js", () => {
  const data = new Map<string, Record<string, string>>();
  const keys = new Set<string>();

  const redis = {
    _data: data,
    _keys: keys,
    hset: vi.fn(async (key: string, obj: Record<string, string>) => {
      data.set(key, { ...(data.get(key) ?? {}), ...obj });
    }),
    hincrby: vi.fn(async (key: string, field: string, increment: number) => {
      const hash = data.get(key) ?? {};
      hash[field] = String(parseInt(hash[field] ?? "0", 10) + increment);
      data.set(key, hash);
      return parseInt(hash[field], 10);
    }),
    hmget: vi.fn(async (key: string, ...fields: string[]) => {
      const hash = data.get(key) ?? {};
      return fields.map((f) => hash[f] ?? null);
    }),
    exists: vi.fn(async (key: string) => (keys.has(key) ? 1 : 0)),
    set: vi.fn(async (key: string) => { keys.add(key); }),
    del: vi.fn(async (...ks: string[]) => {
      for (const k of ks) { data.delete(k); keys.delete(k); }
    }),
  };

  return { redis, getRedis: () => redis };
});

vi.mock("@lead-routing/db", () => ({
  prisma: {
    bulkSearchRun: {
      update: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("./batch-matcher.js", () => ({
  batchMatchRecords: vi.fn(async () => new Map()),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(async () => ({ id: `job-${Math.random().toString(36).slice(2)}` })),
    getWaitingCount: vi.fn(async () => 0),
  })),
}));

// ─── Import after mocks ─────────────────────────────────────────────────

import { redis } from "./redis.js";
import { prisma } from "@lead-routing/db";
import { batchMatchRecords } from "./batch-matcher.js";
import {
  runBulkSearch,
  cancelBulkSearch,
  setBulkSearchQueue,
  getBulkSearchQueue,
} from "./bulk-search.js";

// ─── Helpers ─────────────────────────────────────────────────────────────

const mockRedis = redis as any;
const mockPrismaUpdate = (prisma as any).bulkSearchRun.update as ReturnType<typeof vi.fn>;
const mockBatchMatch = batchMatchRecords as ReturnType<typeof vi.fn>;

function getQueue() {
  const q = getBulkSearchQueue();
  return q as any;
}

function createMockStream(records: Record<string, unknown>[]): EventEmitter {
  const emitter = new EventEmitter();
  process.nextTick(() => {
    for (const rec of records) {
      emitter.emit("record", rec);
    }
    emitter.emit("end");
  });
  return emitter;
}

function createMockConn(records: Record<string, unknown>[]) {
  return {
    bulk2: {
      query: vi.fn(async () => createMockStream(records)),
    },
    query: vi.fn(async () => ({ records: [] })),
  };
}

function makeRecords(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => ({
    Id: `001${String(i).padStart(12, "0")}`,
    Email: `user${i}@test.com`,
    Name: `User ${i}`,
  }));
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("runBulkSearch", () => {
  let queue: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis._data.clear();
    mockRedis._keys.clear();

    // Re-create a fresh queue mock for each test
    queue = {
      add: vi.fn(async () => ({ id: `job-${Math.random().toString(36).slice(2)}` })),
      getWaitingCount: vi.fn(async () => 0),
    };
    setBulkSearchQueue(queue as any);

    // Default hmget: simulate all records routed
    mockRedis.hmget.mockImplementation(async (key: string, ...fields: string[]) => {
      const hash = mockRedis._data.get(key) ?? {};
      if (fields.includes("routed") && hash["processed"]) {
        hash["routed"] = hash["processed"];
      }
      return fields.map((f: string) => hash[f] ?? null);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("buffers records and flushes at batchSize", async () => {
    const records = makeRecords(12);
    const conn = createMockConn(records);

    const result = await runBulkSearch(
      conn,
      "SELECT Id, Email FROM Lead",
      "rule-1",
      "org-1",
      "LEAD",
      null,
      { runId: "run-1", batchSize: 5 }
    );

    // 12 records with batchSize 5 => 3 flushes: 5, 5, 2
    expect(queue.add).toHaveBeenCalledTimes(3);

    // Verify first batch has 5 records
    const firstCall = queue.add.mock.calls[0]!;
    expect(firstCall[1].records).toHaveLength(5);

    // Verify second batch has 5 records
    const secondCall = queue.add.mock.calls[1]!;
    expect(secondCall[1].records).toHaveLength(5);

    // Verify third batch has 2 records (remainder)
    const thirdCall = queue.add.mock.calls[2]!;
    expect(thirdCall[1].records).toHaveLength(2);

    expect(result.recordsFound).toBe(12);
    expect(result.status).toBe("SUCCESS");
  });

  it("stops processing when maxRecords is reached", async () => {
    const records = makeRecords(20);
    const conn = createMockConn(records);

    const result = await runBulkSearch(
      conn,
      "SELECT Id FROM Lead",
      "rule-1",
      "org-1",
      "LEAD",
      null,
      { runId: "run-2", batchSize: 5, maxRecords: 8 }
    );

    // Should process at most 8 records
    expect(result.recordsFound).toBeLessThanOrEqual(8);
    // At most 2 batches (5 + 3)
    expect(queue.add.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("handles cancel flag during batch processing", async () => {
    const records = makeRecords(10);
    const conn = createMockConn(records);

    // The cancel flag is checked before each batch flush.
    // Return 1 (cancelled) on the second check so the first batch goes through.
    let cancelCheckCount = 0;
    mockRedis.exists.mockImplementation(async (key: string) => {
      if (key.includes(":cancel")) {
        cancelCheckCount++;
        // Cancel after first batch is processed
        return cancelCheckCount >= 2 ? 1 : 0;
      }
      return 0;
    });

    const result = await runBulkSearch(
      conn,
      "SELECT Id FROM Lead",
      "rule-1",
      "org-1",
      "LEAD",
      null,
      { runId: "run-cancel", batchSize: 5 }
    );

    expect(result.status).toBe("CANCELLED");
    // Only 1 batch should have been processed before cancellation
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it("updates DB row to FAILED on stream error", async () => {
    const emitter = new EventEmitter();
    const conn = {
      bulk2: { query: vi.fn(async () => emitter) },
      query: vi.fn(async () => ({ records: [] })),
    };

    process.nextTick(() => {
      emitter.emit("error", new Error("SFDC Bulk API timeout"));
    });

    const result = await runBulkSearch(
      conn,
      "SELECT Id FROM Lead",
      "rule-1",
      "org-1",
      "LEAD",
      null,
      { runId: "run-err", batchSize: 500 }
    );

    expect(result.status).toBe("FAILED");
    expect(result.error).toBe("SFDC Bulk API timeout");

    expect(mockPrismaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-err" },
        data: expect.objectContaining({
          status: "FAILED",
          error: "SFDC Bulk API timeout",
        }),
      })
    );
  });

  it("calls batchMatchRecords when matchConfig is provided", async () => {
    const records = makeRecords(3);
    const conn = createMockConn(records);

    const matchConfig = {
      checkLeads: true, checkContacts: false, checkAccounts: false,
      matchEmail: true, matchPhone: false, matchDomain: false, matchCompanyName: false,
      fuzzyMatchMode: "STRICT",
      onLeadMatch: "SFDC_MERGE",
      leadAssignmentType: null, leadAssigneeUserId: null, leadAssigneeTeamId: null, leadAssigneeQueueId: null,
      onContactMatch: "ASSIGN_TO_OWNER",
      contactAssignmentType: null, contactAssigneeUserId: null, contactAssigneeTeamId: null, contactAssigneeQueueId: null,
      onAccountMatch: "ASSIGN_TO_OWNER",
      accountAssignmentType: null, accountAssigneeUserId: null, accountAssigneeTeamId: null, accountAssigneeQueueId: null,
    };

    await runBulkSearch(
      conn,
      "SELECT Id FROM Lead",
      "rule-1",
      "org-1",
      "LEAD",
      matchConfig,
      { runId: "run-match", batchSize: 10 }
    );

    expect(mockBatchMatch).toHaveBeenCalledTimes(1);
    expect(mockBatchMatch).toHaveBeenCalledWith(
      conn,
      expect.arrayContaining([
        expect.objectContaining({ recordId: expect.any(String) }),
      ]),
      matchConfig
    );
  });

  it("skips batchMatchRecords when matchConfig is null", async () => {
    const records = makeRecords(3);
    const conn = createMockConn(records);

    await runBulkSearch(
      conn,
      "SELECT Id FROM Lead",
      "rule-1",
      "org-1",
      "LEAD",
      null,
      { runId: "run-nomatch", batchSize: 10 }
    );

    expect(mockBatchMatch).not.toHaveBeenCalled();
  });

  it("handles zero records gracefully", async () => {
    const conn = createMockConn([]);

    const result = await runBulkSearch(
      conn,
      "SELECT Id FROM Lead WHERE Id = null",
      "rule-1",
      "org-1",
      "LEAD",
      null,
      { runId: "run-empty", batchSize: 500 }
    );

    expect(result.status).toBe("SUCCESS");
    expect(result.recordsFound).toBe(0);
    expect(result.recordsProcessed).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("initializes Redis hash with RUNNING status", async () => {
    const conn = createMockConn([]);

    await runBulkSearch(
      conn,
      "SELECT Id FROM Lead",
      "rule-1",
      "org-1",
      "LEAD",
      null,
      { runId: "run-init", batchSize: 500 }
    );

    expect(mockRedis.hset).toHaveBeenCalledWith("bulk-run:run-init", {
      processed: "0",
      routed: "0",
      failed: "0",
      status: "RUNNING",
    });
  });

  it("cleans up Redis keys after completion", async () => {
    const conn = createMockConn(makeRecords(2));

    await runBulkSearch(
      conn,
      "SELECT Id FROM Lead",
      "rule-1",
      "org-1",
      "LEAD",
      null,
      { runId: "run-cleanup", batchSize: 500 }
    );

    expect(mockRedis.del).toHaveBeenCalledWith(
      "bulk-run:run-cleanup",
      "bulk-run:run-cleanup:cancel"
    );
  });

  it("includes orgId, ruleId, runId, and objectType in job data", async () => {
    const records = makeRecords(2);
    const conn = createMockConn(records);

    await runBulkSearch(
      conn,
      "SELECT Id FROM Lead",
      "rule-42",
      "org-7",
      "LEAD",
      null,
      { runId: "run-meta", batchSize: 500 }
    );

    expect(queue.add).toHaveBeenCalledWith(
      "bulk-route-batch",
      expect.objectContaining({
        orgId: "org-7",
        ruleId: "rule-42",
        runId: "run-meta",
        objectType: "LEAD",
      })
    );
  });

  it("reports PARTIAL status when some jobs fail", async () => {
    const records = makeRecords(5);
    const conn = createMockConn(records);

    // Simulate partial failure: 3 routed, 2 failed
    mockRedis.hmget.mockImplementation(async (key: string, ...fields: string[]) => {
      const hash = mockRedis._data.get(key) ?? {};
      if (fields.includes("routed")) hash["routed"] = "3";
      if (fields.includes("failed")) hash["failed"] = "2";
      if (fields.includes("processed")) hash["processed"] = hash["processed"] ?? "5";
      return fields.map((f: string) => hash[f] ?? null);
    });

    const result = await runBulkSearch(
      conn,
      "SELECT Id FROM Lead",
      "rule-1",
      "org-1",
      "LEAD",
      null,
      { runId: "run-partial", batchSize: 10 }
    );

    expect(result.status).toBe("PARTIAL");
    expect(result.recordsRouted).toBe(3);
    expect(result.recordsFailed).toBe(2);
  });
});

describe("cancelBulkSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis._keys.clear();
  });

  it("sets the cancel key in Redis", async () => {
    await cancelBulkSearch("run-to-cancel");

    expect(mockRedis.set).toHaveBeenCalledWith(
      "bulk-run:run-to-cancel:cancel",
      "1",
      "EX",
      3600
    );
  });
});
