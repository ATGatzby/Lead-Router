import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateOwner, bulkUpdateOwners } from "./update-owner.js";
import type { BulkUpdateRecord } from "./update-owner.js";

describe("updateOwner", () => {
  function makeMockConnection() {
    const updateFn = vi.fn().mockResolvedValue({ id: "001", success: true });
    const sobjectFn = vi.fn().mockReturnValue({ update: updateFn });
    return { conn: { sobject: sobjectFn } as any, sobjectFn, updateFn };
  }

  it("calls sobject().update() with correct OwnerId for Lead", async () => {
    const { conn, sobjectFn, updateFn } = makeMockConnection();

    await updateOwner(conn, "Lead", "00Q000000000001", "005000000000001");

    expect(sobjectFn).toHaveBeenCalledWith("Lead");
    expect(updateFn).toHaveBeenCalledWith({
      Id: "00Q000000000001",
      OwnerId: "005000000000001",
    });
  });

  it("calls sobject().update() with correct OwnerId for Contact", async () => {
    const { conn, sobjectFn, updateFn } = makeMockConnection();

    await updateOwner(conn, "Contact", "003000000000001", "005000000000002");

    expect(sobjectFn).toHaveBeenCalledWith("Contact");
    expect(updateFn).toHaveBeenCalledWith({
      Id: "003000000000001",
      OwnerId: "005000000000002",
    });
  });

  it("calls sobject().update() with correct OwnerId for Account", async () => {
    const { conn, sobjectFn, updateFn } = makeMockConnection();

    await updateOwner(conn, "Account", "001000000000001", "00G000000000001");

    expect(sobjectFn).toHaveBeenCalledWith("Account");
    expect(updateFn).toHaveBeenCalledWith({
      Id: "001000000000001",
      OwnerId: "00G000000000001",
    });
  });
});

describe("bulkUpdateOwners", () => {
  function makeBulkConn(mockResult: any) {
    const loadAndWaitForResults = vi.fn().mockResolvedValue(mockResult);
    const conn = { bulk2: { loadAndWaitForResults } } as any;
    return { conn, loadAndWaitForResults };
  }

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

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

    const records: BulkUpdateRecord[] = [
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

  it("handles partial failure: some succeed, some fail", async () => {
    const { conn } = makeBulkConn({
      successfulResults: [
        { sf__Id: "00Q000000000001", sf__Created: "false" },
      ],
      failedResults: [
        { sf__Id: "00Q000000000002", sf__Error: "FIELD_CUSTOM_VALIDATION_EXCEPTION:Owner cannot be blank" },
      ],
      unprocessedRecords: [],
    });

    const records: BulkUpdateRecord[] = [
      { Id: "00Q000000000001", OwnerId: "005000000000001" },
      { Id: "00Q000000000002", OwnerId: "005000000000002" },
    ];

    const result = await bulkUpdateOwners(conn, "Lead", records);

    expect(result.successful).toEqual(["00Q000000000001"]);
    expect(result.failed).toEqual([
      { id: "00Q000000000002", error: "FIELD_CUSTOM_VALIDATION_EXCEPTION:Owner cannot be blank" },
    ]);
    expect(result.unprocessed).toBe(0);
  });

  it("counts unprocessed records", async () => {
    const { conn } = makeBulkConn({
      successfulResults: [{ sf__Id: "00Q000000000001" }],
      failedResults: [],
      unprocessedRecords: [
        { Id: "00Q000000000002", OwnerId: "005000000000002" },
        { Id: "00Q000000000003", OwnerId: "005000000000003" },
      ],
    });

    const records: BulkUpdateRecord[] = [
      { Id: "00Q000000000001", OwnerId: "005000000000001" },
      { Id: "00Q000000000002", OwnerId: "005000000000002" },
      { Id: "00Q000000000003", OwnerId: "005000000000003" },
    ];

    const result = await bulkUpdateOwners(conn, "Lead", records);
    expect(result.unprocessed).toBe(2);
  });

  it("stamps routing action field on records when provided", async () => {
    const { conn, loadAndWaitForResults } = makeBulkConn({
      successfulResults: [{ sf__Id: "00Q000000000001" }],
      failedResults: [],
      unprocessedRecords: [],
    });

    const records: BulkUpdateRecord[] = [
      { Id: "00Q000000000001", OwnerId: "005000000000001" },
    ];

    await bulkUpdateOwners(conn, "Lead", records, "lrt__Routing_Action__c");

    const submittedRecords = loadAndWaitForResults.mock.calls[0][0].input;
    expect(submittedRecords[0]).toHaveProperty("lrt__Routing_Action__c");
    expect(submittedRecords[0]["lrt__Routing_Action__c"]).toMatch(/^assigned:\d{4}-/);
  });

  it("retries without routing action field when all fail with INVALID_FIELD", async () => {
    const loadAndWaitForResults = vi
      .fn()
      .mockResolvedValueOnce({
        // First call: all fail with INVALID_FIELD
        successfulResults: [],
        failedResults: [
          { sf__Id: "00Q000000000001", sf__Error: "INVALID_FIELD:No such column 'lrt__Routing_Action__c'" },
          { sf__Id: "00Q000000000002", sf__Error: "INVALID_FIELD:No such column 'lrt__Routing_Action__c'" },
        ],
        unprocessedRecords: [],
      })
      .mockResolvedValueOnce({
        // Retry: all succeed
        successfulResults: [
          { sf__Id: "00Q000000000001" },
          { sf__Id: "00Q000000000002" },
        ],
        failedResults: [],
        unprocessedRecords: [],
      });

    const conn = { bulk2: { loadAndWaitForResults } } as any;

    const records: BulkUpdateRecord[] = [
      { Id: "00Q000000000001", OwnerId: "005000000000001" },
      { Id: "00Q000000000002", OwnerId: "005000000000002" },
    ];

    const result = await bulkUpdateOwners(conn, "Lead", records, "lrt__Routing_Action__c");

    expect(loadAndWaitForResults).toHaveBeenCalledTimes(2);
    expect(result.successful).toEqual(["00Q000000000001", "00Q000000000002"]);
    expect(result.failed).toEqual([]);

    // Verify retry records don't have the routing action field
    const retryRecords = loadAndWaitForResults.mock.calls[1][0].input;
    expect(retryRecords[0]).not.toHaveProperty("lrt__Routing_Action__c");
  });

  it("does NOT retry when failures are not all INVALID_FIELD", async () => {
    const { conn, loadAndWaitForResults } = makeBulkConn({
      successfulResults: [],
      failedResults: [
        { sf__Id: "00Q000000000001", sf__Error: "INVALID_FIELD:No such column" },
        { sf__Id: "00Q000000000002", sf__Error: "REQUIRED_FIELD_MISSING:OwnerId required" },
      ],
      unprocessedRecords: [],
    });

    const records: BulkUpdateRecord[] = [
      { Id: "00Q000000000001", OwnerId: "005000000000001" },
      { Id: "00Q000000000002", OwnerId: "005000000000002" },
    ];

    const result = await bulkUpdateOwners(conn, "Lead", records, "lrt__Routing_Action__c");

    expect(loadAndWaitForResults).toHaveBeenCalledTimes(1);
    expect(result.failed).toHaveLength(2);
  });
});
