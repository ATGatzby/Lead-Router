import { describe, it, expect, vi, beforeEach } from "vitest";
import { batchMatchRecords, chunkArray, escapeSoql, type CachedMatchConfig } from "./batch-matcher.js";

// ─── Mock jsforce connection ──────────────────────────────────────────────

function createMockConnection(queryResponses: Record<string, { records: any[] }> = {}) {
  return {
    query: vi.fn().mockImplementation(async (soql: string) => {
      // Find matching response by checking if any key is a substring of the SOQL
      for (const [key, response] of Object.entries(queryResponses)) {
        if (soql.includes(key)) return response;
      }
      return { records: [] };
    }),
  } as any;
}

function baseMatchConfig(overrides: Partial<CachedMatchConfig> = {}): CachedMatchConfig {
  return {
    checkLeads: true,
    checkContacts: true,
    checkAccounts: false,
    matchEmail: true,
    matchPhone: false,
    matchDomain: false,
    matchCompanyName: false,
    fuzzyMatchMode: "STRICT",
    onLeadMatch: "SFDC_MERGE",
    leadAssignmentType: null,
    leadAssigneeUserId: null,
    leadAssigneeTeamId: null,
    leadAssigneeQueueId: null,
    onContactMatch: "ASSIGN_TO_OWNER",
    contactAssignmentType: null,
    contactAssigneeUserId: null,
    contactAssigneeTeamId: null,
    contactAssigneeQueueId: null,
    onAccountMatch: "ASSIGN_TO_OWNER",
    accountAssignmentType: null,
    accountAssigneeUserId: null,
    accountAssigneeTeamId: null,
    accountAssigneeQueueId: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("chunkArray", () => {
  it("splits array into chunks of the specified size", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns single chunk when array is smaller than size", () => {
    expect(chunkArray([1, 2], 5)).toEqual([[1, 2]]);
  });

  it("returns empty array for empty input", () => {
    expect(chunkArray([], 5)).toEqual([]);
  });
});

describe("escapeSoql", () => {
  it("escapes single quotes", () => {
    expect(escapeSoql("O'Brien")).toBe("O\\'Brien");
  });

  it("escapes backslashes", () => {
    expect(escapeSoql("a\\b")).toBe("a\\\\b");
  });

  it("escapes both backslashes and quotes", () => {
    expect(escapeSoql("test\\'val")).toBe("test\\\\\\'val");
  });
});

describe("batchMatchRecords", () => {
  it("returns empty map for empty records", async () => {
    const conn = createMockConnection();
    const config = baseMatchConfig();
    const result = await batchMatchRecords(conn, [], config);
    expect(result.size).toBe(0);
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("builds correct SOQL IN clause for email matching", async () => {
    const conn = createMockConnection({
      "FROM Lead": {
        records: [
          { Id: "00Qlead1", OwnerId: "005owner1", Email: "alice@example.com" },
        ],
      },
    });

    const records = [
      { recordId: "rec-1", fields: { Email: "alice@example.com" } },
      { recordId: "rec-2", fields: { Email: "bob@example.com" } },
    ];

    const config = baseMatchConfig({ matchEmail: true, checkLeads: true });
    await batchMatchRecords(conn, records, config);

    // Should have been called with a Lead email query
    const leadCall = conn.query.mock.calls.find(
      (c: any) => c[0].includes("FROM Lead") && c[0].includes("Email IN")
    );
    expect(leadCall).toBeDefined();
    expect(leadCall[0]).toContain("alice@example.com");
    expect(leadCall[0]).toContain("bob@example.com");
    expect(leadCall[0]).toContain("IsConverted = false");
  });

  it("populates results map correctly for email matches", async () => {
    const conn = createMockConnection({
      "FROM Lead": {
        records: [
          { Id: "00Qlead1", OwnerId: "005owner1", Email: "alice@example.com" },
        ],
      },
      "FROM Contact": {
        records: [
          { Id: "003contact1", OwnerId: "005owner2", Email: "bob@example.com" },
        ],
      },
    });

    const records = [
      { recordId: "rec-1", fields: { Email: "alice@example.com" } },
      { recordId: "rec-2", fields: { Email: "bob@example.com" } },
      { recordId: "rec-3", fields: { Email: "nobody@example.com" } },
    ];

    const config = baseMatchConfig({ matchEmail: true, checkLeads: true, checkContacts: true });
    const result = await batchMatchRecords(conn, records, config);

    expect(result.get("rec-1")).toEqual({
      matchedType: "LEAD",
      matchedRecordId: "00Qlead1",
      ownerId: "005owner1",
      matchField: "Email",
    });

    expect(result.get("rec-2")).toEqual({
      matchedType: "CONTACT",
      matchedRecordId: "003contact1",
      ownerId: "005owner2",
      matchField: "Email",
    });

    expect(result.get("rec-3")).toBeNull();
  });

  it("respects priority order — Lead email wins over Contact email", async () => {
    // Both Lead and Contact exist for the same email
    const conn = createMockConnection({
      "FROM Lead": {
        records: [
          { Id: "00Qlead1", OwnerId: "005leadOwner", Email: "shared@example.com" },
        ],
      },
      "FROM Contact": {
        records: [
          { Id: "003contact1", OwnerId: "005contactOwner", Email: "shared@example.com" },
        ],
      },
    });

    const records = [
      { recordId: "rec-1", fields: { Email: "shared@example.com" } },
    ];

    const config = baseMatchConfig({ matchEmail: true, checkLeads: true, checkContacts: true });
    const result = await batchMatchRecords(conn, records, config);

    // Lead should win
    expect(result.get("rec-1")).toEqual({
      matchedType: "LEAD",
      matchedRecordId: "00Qlead1",
      ownerId: "005leadOwner",
      matchField: "Email",
    });
  });

  it("falls back to phone match when email has no match", async () => {
    const conn = createMockConnection({
      "FROM Lead WHERE Phone": {
        records: [
          { Id: "00Qlead2", OwnerId: "005phoneOwner", Phone: "+15551234567" },
        ],
      },
    });

    // No email match queries will return empty (default)
    const records = [
      { recordId: "rec-1", fields: { Email: "nobody@example.com", Phone: "+15551234567" } },
    ];

    const config = baseMatchConfig({
      matchEmail: true,
      matchPhone: true,
      checkLeads: true,
      checkContacts: true,
    });
    const result = await batchMatchRecords(conn, records, config);

    expect(result.get("rec-1")).toEqual({
      matchedType: "LEAD",
      matchedRecordId: "00Qlead2",
      ownerId: "005phoneOwner",
      matchField: "Phone",
    });
  });

  it("matches account by domain when configured", async () => {
    const conn = createMockConnection({
      "FROM Account": {
        records: [
          { Id: "001acct1", OwnerId: "005acctOwner", Website: "https://acme.com" },
        ],
      },
    });

    const records = [
      { recordId: "rec-1", fields: { Email: "user@acme.com" } },
    ];

    const config = baseMatchConfig({
      matchEmail: true,
      matchDomain: true,
      checkLeads: false,
      checkContacts: false,
      checkAccounts: true,
    });
    const result = await batchMatchRecords(conn, records, config);

    expect(result.get("rec-1")).toEqual({
      matchedType: "ACCOUNT",
      matchedRecordId: "001acct1",
      ownerId: "005acctOwner",
      matchField: "Domain",
    });
  });

  it("returns null for all records when no matching is configured", async () => {
    const conn = createMockConnection();
    const records = [
      { recordId: "rec-1", fields: { Email: "alice@example.com" } },
      { recordId: "rec-2", fields: { Email: "bob@example.com" } },
    ];

    const config = baseMatchConfig({
      matchEmail: false,
      matchPhone: false,
      matchDomain: false,
      checkLeads: false,
      checkContacts: false,
      checkAccounts: false,
    });
    const result = await batchMatchRecords(conn, records, config);

    expect(result.get("rec-1")).toBeNull();
    expect(result.get("rec-2")).toBeNull();
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("chunks large batches into multiple queries (>200 unique values)", async () => {
    // Generate 250 unique emails
    const records = Array.from({ length: 250 }, (_, i) => ({
      recordId: `rec-${i}`,
      fields: { Email: `user${i}@example.com` },
    }));

    const conn = createMockConnection();
    const config = baseMatchConfig({ matchEmail: true, checkLeads: true });
    await batchMatchRecords(conn, records, config);

    // Should have been called at least twice for leads (250 / 200 = 2 chunks)
    // Plus contact queries
    const leadCalls = conn.query.mock.calls.filter(
      (c: any) => c[0].includes("FROM Lead") && c[0].includes("Email IN")
    );
    expect(leadCalls.length).toBe(2);

    // First chunk should have 200 emails, second should have 50
    const firstCallEmails = (leadCalls[0][0] as string).match(/user\d+@example\.com/g);
    const secondCallEmails = (leadCalls[1][0] as string).match(/user\d+@example\.com/g);
    expect(firstCallEmails?.length).toBe(200);
    expect(secondCallEmails?.length).toBe(50);
  });

  it("handles SOQL query errors gracefully", async () => {
    const conn = {
      query: vi.fn().mockRejectedValue(new Error("SOQL syntax error")),
    } as any;

    const records = [
      { recordId: "rec-1", fields: { Email: "alice@example.com" } },
    ];

    const config = baseMatchConfig({ matchEmail: true, checkLeads: true });
    // Should not throw
    const result = await batchMatchRecords(conn, records, config);
    expect(result.get("rec-1")).toBeNull();
  });

  it("matches company name in STRICT mode using normalized comparison", async () => {
    const conn = createMockConnection({
      "FROM Account WHERE Name": {
        records: [
          { Id: "001acct1", OwnerId: "005acctOwner", Name: "Acme Corp" },
        ],
      },
    });

    const records = [
      { recordId: "rec-1", fields: { Company: "Acme Corp" } },
    ];

    const config = baseMatchConfig({
      matchEmail: false,
      matchCompanyName: true,
      checkAccounts: true,
      fuzzyMatchMode: "STRICT",
    });
    const result = await batchMatchRecords(conn, records, config);

    expect(result.get("rec-1")).toEqual({
      matchedType: "ACCOUNT",
      matchedRecordId: "001acct1",
      ownerId: "005acctOwner",
      matchField: "CompanyName",
    });
  });

  it("skips company name matching for FUZZY mode (not batchable)", async () => {
    const conn = createMockConnection();
    const records = [
      { recordId: "rec-1", fields: { Company: "Acme Corp" } },
    ];

    const config = baseMatchConfig({
      matchEmail: false,
      matchCompanyName: true,
      checkAccounts: true,
      fuzzyMatchMode: "FUZZY",
    });
    const result = await batchMatchRecords(conn, records, config);

    // No account query should fire for FUZZY mode
    expect(result.get("rec-1")).toBeNull();
  });

  it("skips company name matching for AI_SMART mode (not batchable)", async () => {
    const conn = createMockConnection();
    const records = [
      { recordId: "rec-1", fields: { Company: "Acme Corp" } },
    ];

    const config = baseMatchConfig({
      matchEmail: false,
      matchCompanyName: true,
      checkAccounts: true,
      fuzzyMatchMode: "AI_SMART",
    });
    const result = await batchMatchRecords(conn, records, config);

    expect(result.get("rec-1")).toBeNull();
  });

  it("escapes single quotes in email values for SOQL safety", async () => {
    const conn = createMockConnection();
    const records = [
      { recordId: "rec-1", fields: { Email: "o'brien@example.com" } },
    ];

    const config = baseMatchConfig({ matchEmail: true, checkLeads: true });
    await batchMatchRecords(conn, records, config);

    const leadCall = conn.query.mock.calls.find(
      (c: any) => c[0].includes("FROM Lead")
    );
    expect(leadCall).toBeDefined();
    expect(leadCall[0]).toContain("o\\'brien@example.com");
    expect(leadCall[0]).not.toContain("o'brien@example.com");
  });
});
