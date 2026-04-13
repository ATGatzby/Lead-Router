import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockRuleFindFirst,
  mockRuleUpdate,
  mockBulkSearchRunFindFirst,
  mockBulkSearchRunCreate,
  mockBulkSearchRunUpdate,
  mockGetOrgConnection,
  mockRouteRecord,
  mockRunBulkSearch,
  mockBuildSearchSOQL,
  mockBuildCountSOQL,
  mockQuery,
  mockQueryMore,
  mockQueueAdd,
  mockRedisHset,
  mockRedisExpire,
  mockRedisHgetall,
  mockRedisDel,
} = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockQueryMore = vi.fn();
  const mockQueueAdd = vi.fn().mockResolvedValue({});
  return {
    mockRuleFindFirst: vi.fn(),
    mockRuleUpdate: vi.fn().mockResolvedValue({}),
    mockBulkSearchRunFindFirst: vi.fn(),
    mockBulkSearchRunCreate: vi.fn(),
    mockBulkSearchRunUpdate: vi.fn().mockResolvedValue({}),
    mockGetOrgConnection: vi.fn().mockResolvedValue({ query: mockQuery, queryMore: mockQueryMore }),
    mockRouteRecord: vi.fn().mockResolvedValue("routed"),
    mockRunBulkSearch: vi.fn(),
    mockBuildSearchSOQL: vi.fn().mockReturnValue("SELECT Id FROM Lead WHERE Industry = 'Tech'"),
    mockBuildCountSOQL: vi.fn().mockReturnValue("SELECT COUNT() FROM Lead WHERE Industry = 'Tech'"),
    mockQuery,
    mockQueryMore,
    mockQueueAdd,
    mockRedisHset: vi.fn().mockResolvedValue(0),
    mockRedisExpire: vi.fn().mockResolvedValue(1),
    mockRedisHgetall: vi.fn().mockResolvedValue({}),
    mockRedisDel: vi.fn().mockResolvedValue(1),
  };
});

vi.mock("@lead-routing/db", () => ({
  prisma: {
    routingRule: { findFirst: mockRuleFindFirst, update: mockRuleUpdate },
    bulkSearchRun: { findFirst: mockBulkSearchRunFindFirst, create: mockBulkSearchRunCreate, update: mockBulkSearchRunUpdate },
    organization: { findUnique: vi.fn().mockResolvedValue({ crmType: "SALESFORCE" }) },
  },
}));

vi.mock("./cache.js", () => ({ getActiveRules: vi.fn() }));
vi.mock("./soql-builder.js", () => ({ buildSearchSOQL: mockBuildSearchSOQL, buildCountSOQL: mockBuildCountSOQL }));
vi.mock("./router.js", () => ({ routeRecord: mockRouteRecord }));
vi.mock("./sfdc.js", () => ({ getOrgConnection: mockGetOrgConnection, evictOrgConnection: vi.fn() }));
vi.mock("./bulk-search.js", () => ({ runBulkSearch: mockRunBulkSearch }));
vi.mock("./export-runner.js", () => ({ runExportRoute: vi.fn() }));
vi.mock("./hubspot-connection.js", () => ({ getOrgHubSpotClient: vi.fn(), toCrmObjectType: vi.fn(), evictOrgHubSpotClient: vi.fn() }));
vi.mock("./hubspot-search-builder.js", () => ({ buildSearchRequest: vi.fn(), buildCountRequest: vi.fn() }));
vi.mock("./bulk-search-queue.js", () => ({ getBulkSearchQueue: vi.fn(() => ({ add: mockQueueAdd })) }));
vi.mock("./redis.js", () => ({ redis: { hset: mockRedisHset, expire: mockRedisExpire, hgetall: mockRedisHgetall, del: mockRedisDel } }));

import { runScheduledRoute } from "./search-runner.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    orgId: "org-1",
    objectType: "LEAD",
    status: "ACTIVE",
    routeType: "SCHEDULED",
    searchCriteria: { field: "Industry", operator: "equals", value: "Tech" },
    matchConfig: null,
    searchBatchSize: null,
    searchMaxRecords: null,
    ...overrides,
  };
}

function mockCountQueryResult(count: number) {
  mockQuery.mockResolvedValueOnce({ totalSize: count, done: true, records: [] });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runScheduledRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the connection mock so it always returns fresh query/queryMore
    mockGetOrgConnection.mockResolvedValue({ query: mockQuery, queryMore: mockQueryMore });
  });

  // ── Rule validation ──────────────────────────────────────────────────────

  describe("rule validation", () => {
    it("returns SKIPPED when rule not found", async () => {
      mockRuleFindFirst.mockResolvedValue(null);

      const result = await runScheduledRoute("rule-1", "org-1");

      expect(result.status).toBe("SKIPPED");
      expect(result.error).toMatch(/not found/i);
    });

    it("returns SKIPPED when rule is not SCHEDULED type", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule({ routeType: "TRIGGER" }));

      const result = await runScheduledRoute("rule-1", "org-1");

      expect(result.status).toBe("SKIPPED");
      expect(result.error).toMatch(/not a scheduled/i);
    });
  });

  // ── Threshold branching ──────────────────────────────────────────────────

  describe("threshold branching", () => {
    it("uses REST path when COUNT < 2000", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockBulkSearchRunCreate.mockResolvedValue({ id: "run-rest-1" });
      mockRedisHgetall.mockResolvedValue({ routed: "1", failed: "0" });
      // COUNT query returns 500
      mockCountQueryResult(500);
      // REST search query
      mockQuery.mockResolvedValueOnce({ totalSize: 500, done: true, records: [{ Id: "001" }] });

      await runScheduledRoute("rule-1", "org-1");

      expect(mockQueueAdd).toHaveBeenCalled();
      expect(mockRunBulkSearch).not.toHaveBeenCalled();
    });

    it("uses Bulk path when COUNT >= 2000", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(5000);
      mockBulkSearchRunFindFirst.mockResolvedValue(null);
      mockBulkSearchRunCreate.mockResolvedValue({ id: "run-1" });
      mockRunBulkSearch.mockResolvedValue({
        status: "SUCCESS",
        recordsFound: 5000,
        recordsRouted: 5000,
        recordsFailed: 0,
      });

      await runScheduledRoute("rule-1", "org-1");

      expect(mockRunBulkSearch).toHaveBeenCalled();
      expect(mockRouteRecord).not.toHaveBeenCalled();
    });

    it("uses Bulk path when COUNT is exactly 2000 (boundary)", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(2000);
      mockBulkSearchRunFindFirst.mockResolvedValue(null);
      mockBulkSearchRunCreate.mockResolvedValue({ id: "run-1" });
      mockRunBulkSearch.mockResolvedValue({
        status: "SUCCESS",
        recordsFound: 2000,
        recordsRouted: 2000,
        recordsFailed: 0,
      });

      await runScheduledRoute("rule-1", "org-1");

      expect(mockRunBulkSearch).toHaveBeenCalled();
      expect(mockRouteRecord).not.toHaveBeenCalled();
    });

    it("uses REST path when COUNT is 1999 (boundary)", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockBulkSearchRunCreate.mockResolvedValue({ id: "run-rest-2" });
      mockRedisHgetall.mockResolvedValue({ routed: "1", failed: "0" });
      mockCountQueryResult(1999);
      mockQuery.mockResolvedValueOnce({ totalSize: 1999, done: true, records: [{ Id: "001" }] });

      await runScheduledRoute("rule-1", "org-1");

      expect(mockQueueAdd).toHaveBeenCalled();
      expect(mockRunBulkSearch).not.toHaveBeenCalled();
    });
  });

  // ── REST path ────────────────────────────────────────────────────────────

  describe("REST path", () => {
    beforeEach(() => {
      mockBulkSearchRunCreate.mockResolvedValue({ id: "run-rest-1" });
    });

    it("returns SUCCESS with correct recordsFound and recordsRouted", async () => {
      const records = [{ Id: "001" }, { Id: "002" }, { Id: "003" }];
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(3);
      mockQuery.mockResolvedValueOnce({ totalSize: 3, done: true, records });
      mockRedisHgetall.mockResolvedValue({ routed: "3", failed: "0" });

      const result = await runScheduledRoute("rule-1", "org-1");

      expect(result.status).toBe("SUCCESS");
      expect(result.recordsFound).toBe(3);
      expect(result.recordsRouted).toBe(3);
      expect(mockQueueAdd).toHaveBeenCalled();
    });

    it("handles paginated results with queryMore", async () => {
      const page1 = [{ Id: "001" }, { Id: "002" }];
      const page2 = [{ Id: "003" }];
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(3);
      mockQuery.mockResolvedValueOnce({
        totalSize: 3,
        done: false,
        records: page1,
        nextRecordsUrl: "/services/data/v59.0/query/01g...-2000",
      });
      mockQueryMore.mockResolvedValueOnce({ totalSize: 3, done: true, records: page2 });
      mockRedisHgetall.mockResolvedValue({ routed: "3", failed: "0" });

      const result = await runScheduledRoute("rule-1", "org-1");

      expect(mockQueryMore).toHaveBeenCalledWith("/services/data/v59.0/query/01g...-2000");
      expect(result.recordsFound).toBe(3);
      expect(result.recordsRouted).toBe(3);
      expect(mockQueueAdd).toHaveBeenCalled();
    });

    it("returns SUCCESS with 0 records when query returns empty", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(0);
      mockQuery.mockResolvedValueOnce({ totalSize: 0, done: true, records: [] });

      const result = await runScheduledRoute("rule-1", "org-1");

      expect(result.status).toBe("SUCCESS");
      expect(result.recordsFound).toBe(0);
      expect(result.recordsRouted).toBe(0);
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });

    it("returns FAILED when all records fail routing (via Redis poll)", async () => {
      const records = [{ Id: "001" }, { Id: "002" }];
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(2);
      mockQuery.mockResolvedValueOnce({ totalSize: 2, done: true, records });
      mockRedisHgetall.mockResolvedValue({ routed: "0", failed: "2" });

      const result = await runScheduledRoute("rule-1", "org-1");

      expect(result.status).toBe("FAILED");
      expect(result.recordsRouted).toBe(0);
      expect(result.recordsFailed).toBe(2);
    });

    it("creates a bulkSearchRun and enqueues records to the bulk pipeline", async () => {
      const records = [{ Id: "001" }, { Id: "002" }];
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(2);
      mockQuery.mockResolvedValueOnce({ totalSize: 2, done: true, records });
      mockRedisHgetall.mockResolvedValue({ routed: "2", failed: "0" });

      await runScheduledRoute("rule-1", "org-1");

      expect(mockBulkSearchRunCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ orgId: "org-1", ruleId: "rule-1", status: "RUNNING", recordsFound: 2 }),
      });
      expect(mockRedisHset).toHaveBeenCalled();
      expect(mockRedisExpire).toHaveBeenCalled();
      expect(mockQueueAdd).toHaveBeenCalled();
      expect(mockRedisDel).toHaveBeenCalled();
    });

    it("updates bulkSearchRun on completion and cleans up Redis", async () => {
      const records = [{ Id: "001" }];
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(1);
      mockQuery.mockResolvedValueOnce({ totalSize: 1, done: true, records });
      mockRedisHgetall.mockResolvedValue({ routed: "1", failed: "0" });

      await runScheduledRoute("rule-1", "org-1");

      expect(mockBulkSearchRunUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "run-rest-1" },
          data: expect.objectContaining({ status: "COMPLETED", recordsRouted: 1, recordsFailed: 0 }),
        })
      );
      expect(mockRedisDel).toHaveBeenCalledWith("bulk-run:run-rest-1");
    });
  });

  // ── Bulk path ────────────────────────────────────────────────────────────

  describe("Bulk path", () => {
    beforeEach(() => {
      mockBulkSearchRunFindFirst.mockResolvedValue(null);
      mockBulkSearchRunCreate.mockResolvedValue({ id: "run-1" });
      mockRunBulkSearch.mockResolvedValue({
        status: "SUCCESS",
        recordsFound: 3000,
        recordsRouted: 3000,
        recordsFailed: 0,
      });
    });

    it("creates BulkSearchRun DB row with orgId, ruleId, recordsFound", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(3000);

      await runScheduledRoute("rule-1", "org-1");

      expect(mockBulkSearchRunCreate).toHaveBeenCalledWith({
        data: { orgId: "org-1", ruleId: "rule-1", recordsFound: 3000 },
      });
    });

    it("uses omitLimit=true in buildSearchSOQL for bulk path", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(3000);

      await runScheduledRoute("rule-1", "org-1");

      // buildSearchSOQL should be called with omitLimit=true (4th arg)
      expect(mockBuildSearchSOQL).toHaveBeenCalledWith(
        "LEAD",
        expect.anything(),
        0,
        true
      );
    });

    it("passes searchMaxRecords and searchBatchSize from rule", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule({
        searchMaxRecords: 50000,
        searchBatchSize: 5000,
      }));
      mockCountQueryResult(3000);

      await runScheduledRoute("rule-1", "org-1");

      expect(mockRunBulkSearch).toHaveBeenCalledWith(
        expect.anything(), // conn
        expect.any(String), // soql
        "rule-1",
        "org-1",
        "LEAD",
        null, // matchConfig
        expect.objectContaining({
          runId: "run-1",
          maxRecords: 50000,
          batchSize: 5000,
        })
      );
    });

    it("auto-scales batch size to 10000 when count >= 10000 and no user batch size", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(15000);

      await runScheduledRoute("rule-1", "org-1");

      expect(mockRunBulkSearch).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        "rule-1",
        "org-1",
        "LEAD",
        null,
        expect.objectContaining({ batchSize: 10000 })
      );
    });

    it("auto-scales batch size to 500 when count < 10000 and no user batch size", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(3000);

      await runScheduledRoute("rule-1", "org-1");

      expect(mockRunBulkSearch).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        "rule-1",
        "org-1",
        "LEAD",
        null,
        expect.objectContaining({ batchSize: 500 })
      );
    });

    it("returns the bulk result status directly (spread from runBulkSearch)", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(5000);
      mockRunBulkSearch.mockResolvedValue({
        status: "SUCCESS",
        recordsFound: 5000,
        recordsRouted: 4800,
        recordsFailed: 200,
      });

      const result = await runScheduledRoute("rule-1", "org-1");

      // The return value spreads the bulk result, so status comes from runBulkSearch
      expect(result.status).toBe("SUCCESS");
      // But updateRuleStats receives the computed status (PARTIAL)
      expect(mockRuleUpdate).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: expect.objectContaining({
          lastRunStatus: "PARTIAL",
        }),
      });
    });
  });

  // ── Stale run detection ──────────────────────────────────────────────────

  describe("stale run detection", () => {
    it("returns SKIPPED when existing RUNNING BulkSearchRun found within 6 hours", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(5000);
      mockBulkSearchRunFindFirst.mockResolvedValue({
        id: "existing-run",
        status: "RUNNING",
        startedAt: new Date(), // just now
      });

      const result = await runScheduledRoute("rule-1", "org-1");

      expect(result.status).toBe("SKIPPED");
      expect(mockRunBulkSearch).not.toHaveBeenCalled();
      expect(mockBulkSearchRunCreate).not.toHaveBeenCalled();
    });

    it("proceeds when no existing RUNNING run found", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockCountQueryResult(3000);
      mockBulkSearchRunFindFirst.mockResolvedValue(null);
      mockBulkSearchRunCreate.mockResolvedValue({ id: "run-1" });
      mockRunBulkSearch.mockResolvedValue({
        status: "SUCCESS",
        recordsFound: 3000,
        recordsRouted: 3000,
        recordsFailed: 0,
      });

      const result = await runScheduledRoute("rule-1", "org-1");

      expect(result.status).toBe("SUCCESS");
      expect(mockRunBulkSearch).toHaveBeenCalled();
    });
  });

  // ── Error handling ───────────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns FAILED when getOrgConnection throws", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockGetOrgConnection.mockRejectedValueOnce(new Error("SFDC auth failed"));

      const result = await runScheduledRoute("rule-1", "org-1");

      expect(result.status).toBe("FAILED");
      expect(result.error).toBe("SFDC auth failed");
    });

    it("returns FAILED when count query throws", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockQuery.mockRejectedValueOnce(new Error("INVALID_FIELD"));

      const result = await runScheduledRoute("rule-1", "org-1");

      expect(result.status).toBe("FAILED");
      expect(result.error).toBe("INVALID_FIELD");
    });

    it("updates rule stats to FAILED on error", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockGetOrgConnection.mockRejectedValueOnce(new Error("connection error"));

      await runScheduledRoute("rule-1", "org-1");

      expect(mockRuleUpdate).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: expect.objectContaining({
          lastRunStatus: "FAILED",
          lastRunRecords: 0,
          totalRuns: { increment: 1 },
          totalRecordsRouted: { increment: 0 },
        }),
      });
    });
  });

  // ── updateRuleStats ──────────────────────────────────────────────────────

  describe("updateRuleStats", () => {
    it("correctly increments totalRuns and totalRecordsRouted on SUCCESS", async () => {
      const records = [{ Id: "001" }, { Id: "002" }];
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockBulkSearchRunCreate.mockResolvedValue({ id: "run-stats-1" });
      mockRedisHgetall.mockResolvedValue({ routed: "2", failed: "0" });
      mockCountQueryResult(2);
      mockQuery.mockResolvedValueOnce({ totalSize: 2, done: true, records });

      await runScheduledRoute("rule-1", "org-1");

      expect(mockRuleUpdate).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: expect.objectContaining({
          lastRunStatus: "SUCCESS",
          lastRunRecords: 2,
          totalRuns: { increment: 1 },
          totalRecordsRouted: { increment: 2 },
        }),
      });
    });

    it("does not throw when updateRuleStats fails (swallows error)", async () => {
      mockRuleFindFirst.mockResolvedValue(makeRule());
      mockBulkSearchRunCreate.mockResolvedValue({ id: "run-stats-2" });
      mockRedisHgetall.mockResolvedValue({ routed: "1", failed: "0" });
      mockCountQueryResult(1);
      mockQuery.mockResolvedValueOnce({ totalSize: 1, done: true, records: [{ Id: "001" }] });
      mockRuleUpdate.mockRejectedValueOnce(new Error("DB unavailable"));

      // Should not throw
      const result = await runScheduledRoute("rule-1", "org-1");
      expect(result.status).toBe("SUCCESS");
    });
  });
});
