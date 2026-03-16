import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Test updateOwner (basic SFDC sobject update) ────────────────────────────

describe("updateOwner", () => {
  // Import directly — updateOwner only uses conn.sobject().update(), no jsforce types
  let updateOwner: typeof import("../../../packages/sfdc/src/update-owner")["updateOwner"];

  beforeEach(async () => {
    const mod = await import("../../../packages/sfdc/src/update-owner");
    updateOwner = mod.updateOwner;
  });

  function makeMockConnection() {
    const updateFn = vi.fn().mockResolvedValue({ id: "001", success: true });
    const sobjectFn = vi.fn().mockReturnValue({ update: updateFn });
    return { conn: { sobject: sobjectFn } as any, sobjectFn, updateFn };
  }

  it("calls sobject().update() with correct OwnerId for Lead", async () => {
    const { conn, sobjectFn, updateFn } = makeMockConnection();
    await updateOwner(conn, "Lead", "00Q000000000001", "005000000000001");
    expect(sobjectFn).toHaveBeenCalledWith("Lead");
    expect(updateFn).toHaveBeenCalledWith({ Id: "00Q000000000001", OwnerId: "005000000000001" });
  });

  it("calls sobject().update() with correct OwnerId for Contact", async () => {
    const { conn, sobjectFn, updateFn } = makeMockConnection();
    await updateOwner(conn, "Contact", "003000000000001", "005000000000002");
    expect(sobjectFn).toHaveBeenCalledWith("Contact");
    expect(updateFn).toHaveBeenCalledWith({ Id: "003000000000001", OwnerId: "005000000000002" });
  });

  it("calls sobject().update() with correct OwnerId for Account", async () => {
    const { conn, sobjectFn, updateFn } = makeMockConnection();
    await updateOwner(conn, "Account", "001000000000001", "00G000000000001");
    expect(sobjectFn).toHaveBeenCalledWith("Account");
    expect(updateFn).toHaveBeenCalledWith({ Id: "001000000000001", OwnerId: "00G000000000001" });
  });
});

// ─── Test bulkUpdateOwners (Bulk API 2.0 ingest) ─────────────────────────────
// These tests don't import the real function — they test the logic by
// calling the function with a fully mocked connection. This avoids jsforce
// type resolution issues in CI.

describe("bulkUpdateOwners", () => {
  // Inline the function behavior to test without importing jsforce-dependent code
  // The real function is at packages/sfdc/src/update-owner.ts
  let bulkUpdateOwners: (...args: any[]) => Promise<any>;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const mod = await import("../../../packages/sfdc/src/update-owner");
      bulkUpdateOwners = mod.bulkUpdateOwners;
    } catch {
      // If import fails (CI jsforce issue), skip these tests
      bulkUpdateOwners = async () => { throw new Error("SKIP"); };
    }
  });

  function makeBulkConn(mockResult: any) {
    const loadAndWaitForResults = vi.fn().mockResolvedValue(mockResult);
    const conn = { bulk2: { loadAndWaitForResults } } as any;
    return { conn, loadAndWaitForResults };
  }

  it("returns empty result for empty records array", async () => {
    const { conn } = makeBulkConn({});
    const result = await bulkUpdateOwners(conn, "Lead", []);
    expect(result).toEqual({ successful: [], failed: [], unprocessed: 0 });
  });

  it("returns successful IDs on full success", async () => {
    const { conn, loadAndWaitForResults } = makeBulkConn({
      successfulResults: [
        { sf__Id: "00Q000000000001", sf__Created: "false" },
        { sf__Id: "00Q000000000002", sf__Created: "false" },
      ],
      failedResults: [],
      unprocessedRecords: [],
    });

    const records = [
      { Id: "00Q000000000001", OwnerId: "005000000000001" },
      { Id: "00Q000000000002", OwnerId: "005000000000002" },
    ];

    const result = await bulkUpdateOwners(conn, "Lead", records);
    expect(result.successful).toEqual(["00Q000000000001", "00Q000000000002"]);
    expect(result.failed).toEqual([]);
    expect(result.unprocessed).toBe(0);
    expect(loadAndWaitForResults).toHaveBeenCalledWith({
      object: "Lead",
      operation: "update",
      input: records,
      pollTimeout: 300_000,
      pollInterval: 5_000,
    });
  });

  it("handles partial failure", async () => {
    const { conn } = makeBulkConn({
      successfulResults: [{ sf__Id: "00Q000000000001", sf__Created: "false" }],
      failedResults: [{ sf__Id: "00Q000000000002", sf__Error: "VALIDATION:Owner cannot be blank" }],
      unprocessedRecords: [],
    });

    const records = [
      { Id: "00Q000000000001", OwnerId: "005000000000001" },
      { Id: "00Q000000000002", OwnerId: "005000000000002" },
    ];

    const result = await bulkUpdateOwners(conn, "Lead", records);
    expect(result.successful).toEqual(["00Q000000000001"]);
    expect(result.failed).toEqual([{ id: "00Q000000000002", error: "VALIDATION:Owner cannot be blank" }]);
  });

  it("counts unprocessed records", async () => {
    const { conn } = makeBulkConn({
      successfulResults: [{ sf__Id: "00Q000000000001" }],
      failedResults: [],
      unprocessedRecords: [{ Id: "00Q000000000002" }, { Id: "00Q000000000003" }],
    });

    const result = await bulkUpdateOwners(conn, "Lead", [
      { Id: "00Q000000000001", OwnerId: "005000000000001" },
      { Id: "00Q000000000002", OwnerId: "005000000000002" },
      { Id: "00Q000000000003", OwnerId: "005000000000003" },
    ]);
    expect(result.unprocessed).toBe(2);
  });

  it("stamps routing action field when provided", async () => {
    const { conn, loadAndWaitForResults } = makeBulkConn({
      successfulResults: [{ sf__Id: "00Q000000000001" }],
      failedResults: [],
      unprocessedRecords: [],
    });

    await bulkUpdateOwners(conn, "Lead", [{ Id: "00Q000000000001", OwnerId: "005000000000001" }], "lrt__Routing_Action__c");

    const submitted = loadAndWaitForResults.mock.calls[0][0].input;
    expect(submitted[0]).toHaveProperty("lrt__Routing_Action__c");
    expect(submitted[0]["lrt__Routing_Action__c"]).toMatch(/^assigned:\d{4}-/);
  });

  it("retries without routing action field on INVALID_FIELD", async () => {
    const loadAndWaitForResults = vi.fn()
      .mockResolvedValueOnce({
        successfulResults: [],
        failedResults: [
          { sf__Id: "00Q000000000001", sf__Error: "INVALID_FIELD:No such column" },
          { sf__Id: "00Q000000000002", sf__Error: "INVALID_FIELD:No such column" },
        ],
        unprocessedRecords: [],
      })
      .mockResolvedValueOnce({
        successfulResults: [{ sf__Id: "00Q000000000001" }, { sf__Id: "00Q000000000002" }],
        failedResults: [],
        unprocessedRecords: [],
      });

    const conn = { bulk2: { loadAndWaitForResults } } as any;
    const records = [
      { Id: "00Q000000000001", OwnerId: "005000000000001" },
      { Id: "00Q000000000002", OwnerId: "005000000000002" },
    ];

    const result = await bulkUpdateOwners(conn, "Lead", records, "lrt__Routing_Action__c");
    expect(loadAndWaitForResults).toHaveBeenCalledTimes(2);
    expect(result.successful).toEqual(["00Q000000000001", "00Q000000000002"]);

    const retryRecords = loadAndWaitForResults.mock.calls[1][0].input;
    expect(retryRecords[0]).not.toHaveProperty("lrt__Routing_Action__c");
  });

  it("does NOT retry when failures are mixed types", async () => {
    const { conn, loadAndWaitForResults } = makeBulkConn({
      successfulResults: [],
      failedResults: [
        { sf__Id: "00Q000000000001", sf__Error: "INVALID_FIELD:No such column" },
        { sf__Id: "00Q000000000002", sf__Error: "REQUIRED_FIELD_MISSING:OwnerId required" },
      ],
      unprocessedRecords: [],
    });

    const result = await bulkUpdateOwners(conn, "Lead", [
      { Id: "00Q000000000001", OwnerId: "005000000000001" },
      { Id: "00Q000000000002", OwnerId: "005000000000002" },
    ], "lrt__Routing_Action__c");

    expect(loadAndWaitForResults).toHaveBeenCalledTimes(1);
    expect(result.failed).toHaveLength(2);
  });
});
