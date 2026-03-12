import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (hoisted to avoid TDZ issues with vi.mock) ─────────────
const { mockHeadersMap, mockPrisma, mockQuery, mockComposite, mockFetch } = vi.hoisted(() => {
  const mockHeadersMap = new Map<string, string>();
  const mockPrisma = {
    routingRule: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      findUnique: vi.fn(),
    },
  };
  const mockQuery = vi.fn();
  const mockComposite = vi.fn();
  const mockFetch = vi.fn();
  return { mockHeadersMap, mockPrisma, mockQuery, mockComposite, mockFetch };
});

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({
    get: (key: string) => mockHeadersMap.get(key) ?? null,
  })),
}));

vi.mock("@lead-routing/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/auth", () => ({
  getOrgIdFromHeaders: vi.fn(async () => {
    const orgId = mockHeadersMap.get("x-org-id");
    if (!orgId) throw new Error("Missing x-org-id header");
    return orgId;
  }),
}));

vi.mock("@lead-routing/sfdc", () => ({
  SalesforceApi: vi.fn().mockImplementation(() => ({
    query: mockQuery,
    composite: mockComposite,
  })),
}));

vi.stubGlobal("fetch", mockFetch);

// Import the route handler after mocks are set up
import { POST } from "./route";
import { NextRequest } from "next/server";

// ── Helpers ────────────────────────────────────────────────────────

function createRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/rules/rule-1/sync-criteria", {
    method: "POST",
  });
}

function createParams(id = "rule-1"): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const ORG_ID = "org-123";
const SFDC_ORG_ID = "00D000000000001";
const INSTANCE_URL = "https://test.salesforce.com";
const ACCESS_TOKEN = "mock-access-token";

const ALL_REQUIRED_FIELDS = [
  "Rule_Id__c",
  "Object_Type__c",
  "Event_Type__c",
  "Group_Id__c",
  "Field_Name__c",
  "Operator__c",
  "Value__c",
  "Is_Active__c",
];

function setupOrg(overrides?: Partial<{
  sfdcOrgId: string | null;
  sfdcInstanceUrl: string | null;
  oauthAccessToken: string | null;
  oauthRefreshToken: string | null;
}>) {
  mockPrisma.organization.findUnique.mockResolvedValue({
    sfdcOrgId: SFDC_ORG_ID,
    sfdcInstanceUrl: INSTANCE_URL,
    oauthAccessToken: ACCESS_TOKEN,
    oauthRefreshToken: "mock-refresh",
    ...overrides,
  });
}

function setupDescribeSuccess(fields: string[] = ALL_REQUIRED_FIELDS) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      fields: fields.map((name) => ({ name })),
    }),
  });
}

function setupDescribeFailure(status = 404, body = "Not found") {
  mockFetch.mockResolvedValue({
    ok: false,
    status,
    text: async () => body,
  });
}

function makeRule(overrides?: Record<string, unknown>) {
  return {
    id: "rule-1",
    orgId: ORG_ID,
    objectType: "LEAD",
    triggerEvent: "INSERT",
    status: "ACTIVE",
    triggerConditions: [],
    ...overrides,
  };
}

function makeCondition(overrides?: Record<string, unknown>) {
  return {
    id: "cond-1",
    groupId: "group-1",
    fieldName: "Industry",
    operator: "EQUALS",
    value: "Technology",
    sortOrder: 0,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("POST /api/rules/:id/sync-criteria", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHeadersMap.clear();
    mockHeadersMap.set("x-org-id", ORG_ID);
  });

  // ── Auth / basic validation ──────────────────────────────────────

  describe("authentication and validation", () => {
    it("returns 404 when rule is not found", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(null);
      setupOrg();

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.error).toBe("Rule not found");
    });

    it("returns 400 when Salesforce is not connected (no sfdcOrgId)", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg({ sfdcOrgId: null });

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Salesforce not connected");
    });

    it("returns 400 when Salesforce is not connected (no access token)", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg({ oauthAccessToken: null });

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Salesforce not connected");
    });

    it("returns 400 when Salesforce is not connected (no instance URL)", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg({ sfdcInstanceUrl: null });

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Salesforce not connected");
    });
  });

  // ── Describe validation ──────────────────────────────────────────

  describe("Route_Criteria__c describe validation", () => {
    it("returns 422 when describe call fails (object not found)", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg();
      setupDescribeFailure(404, '[{"errorCode":"NOT_FOUND","message":"sObject type Route_Criteria__c not found"}]');

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toContain("Route_Criteria__c not found in Salesforce");
      expect(body.details).toContain("NOT_FOUND");
    });

    it("returns 422 when required fields are missing", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg();
      // Only return some fields, missing several required ones
      setupDescribeSuccess(["Rule_Id__c", "Object_Type__c"]);

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error).toContain("missing fields");
      // Should list the specific missing fields
      expect(body.error).toContain("Event_Type__c");
      expect(body.error).toContain("Group_Id__c");
      expect(body.error).toContain("Field_Name__c");
      expect(body.error).toContain("Operator__c");
      expect(body.error).toContain("Value__c");
      expect(body.error).toContain("Is_Active__c");
    });

    it("passes validation when all required fields are present (plus extras)", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg();
      // All required fields plus some standard ones
      setupDescribeSuccess([...ALL_REQUIRED_FIELDS, "Id", "Name", "CreatedDate", "Sort_Order__c"]);
      mockQuery.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
    });

    it("calls describe with correct URL and auth header", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      await POST(createRequest(), createParams());

      expect(mockFetch).toHaveBeenCalledWith(
        `${INSTANCE_URL}/services/data/v59.0/sobjects/Route_Criteria__c/describe/`,
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
      );
    });
  });

  // ── Delete existing criteria ─────────────────────────────────────

  describe("deleting existing criteria", () => {
    it("deletes existing Route_Criteria__c records for the rule", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([{ Id: "a01000001" }, { Id: "a01000002" }]);
      mockComposite.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.deleted).toBe(2);

      // Verify SOQL query
      expect(mockQuery).toHaveBeenCalledWith(
        "SELECT Id FROM Route_Criteria__c WHERE Rule_Id__c = 'rule-1'"
      );

      // Verify composite delete call
      expect(mockComposite).toHaveBeenCalledWith([
        {
          method: "DELETE",
          url: "/services/data/v59.0/sobjects/Route_Criteria__c/a01000001",
          referenceId: "delete_0",
        },
        {
          method: "DELETE",
          url: "/services/data/v59.0/sobjects/Route_Criteria__c/a01000002",
          referenceId: "delete_1",
        },
      ]);
    });

    it("skips delete when no existing records", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(body.deleted).toBe(0);
      // composite should not be called for deletes
      expect(mockComposite).not.toHaveBeenCalled();
    });

    it("batches deletes in groups of 25", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg();
      setupDescribeSuccess();

      // 30 existing records → 2 batches (25 + 5)
      const existing = Array.from({ length: 30 }, (_, i) => ({
        Id: `a01${String(i).padStart(6, "0")}`,
      }));
      mockQuery.mockResolvedValue(existing);
      mockComposite.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      await POST(createRequest(), createParams());

      // Should have 2 composite calls for deletes
      expect(mockComposite).toHaveBeenCalledTimes(2);

      // First batch: 25 records
      const firstCall = mockComposite.mock.calls[0][0];
      expect(firstCall).toHaveLength(25);
      expect(firstCall[0].referenceId).toBe("delete_0");
      expect(firstCall[24].referenceId).toBe("delete_24");

      // Second batch: 5 records
      const secondCall = mockComposite.mock.calls[1][0];
      expect(secondCall).toHaveLength(5);
      expect(secondCall[0].referenceId).toBe("delete_25");
      expect(secondCall[4].referenceId).toBe("delete_29");
    });
  });

  // ── Create new criteria ──────────────────────────────────────────

  describe("creating new criteria", () => {
    it("creates Route_Criteria__c records from trigger conditions", async () => {
      const conditions = [
        makeCondition({ id: "c1", groupId: "g1", fieldName: "Industry", operator: "EQUALS", value: "Tech", sortOrder: 0 }),
        makeCondition({ id: "c2", groupId: "g1", fieldName: "AnnualRevenue", operator: "GREATER_THAN", value: "1000000", sortOrder: 1 }),
      ];

      mockPrisma.routingRule.findFirst.mockResolvedValue(
        makeRule({ triggerConditions: conditions, objectType: "LEAD", triggerEvent: "INSERT", status: "ACTIVE" })
      );
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([]);
      mockComposite.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.created).toBe(2);

      // Verify composite create call
      expect(mockComposite).toHaveBeenCalledWith([
        {
          method: "POST",
          url: "/services/data/v59.0/sobjects/Route_Criteria__c",
          referenceId: "create_0",
          body: {
            Rule_Id__c: "rule-1",
            Object_Type__c: "LEAD",
            Event_Type__c: "INSERT",
            Group_Id__c: "g1",
            Field_Name__c: "Industry",
            Operator__c: "EQUALS",
            Value__c: "Tech",
            Sort_Order__c: 0,
            Is_Active__c: true,
          },
        },
        {
          method: "POST",
          url: "/services/data/v59.0/sobjects/Route_Criteria__c",
          referenceId: "create_1",
          body: {
            Rule_Id__c: "rule-1",
            Object_Type__c: "LEAD",
            Event_Type__c: "INSERT",
            Group_Id__c: "g1",
            Field_Name__c: "AnnualRevenue",
            Operator__c: "GREATER_THAN",
            Value__c: "1000000",
            Sort_Order__c: 1,
            Is_Active__c: true,
          },
        },
      ]);
    });

    it("sets Is_Active__c to false when rule is not ACTIVE", async () => {
      const conditions = [makeCondition()];

      mockPrisma.routingRule.findFirst.mockResolvedValue(
        makeRule({ triggerConditions: conditions, status: "DRAFT" })
      );
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([]);
      mockComposite.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      await POST(createRequest(), createParams());

      const createCall = mockComposite.mock.calls[0][0];
      expect(createCall[0].body.Is_Active__c).toBe(false);
    });

    it("batches creates in groups of 25", async () => {
      const conditions = Array.from({ length: 30 }, (_, i) =>
        makeCondition({ id: `c${i}`, sortOrder: i })
      );

      mockPrisma.routingRule.findFirst.mockResolvedValue(
        makeRule({ triggerConditions: conditions })
      );
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([]); // no existing
      mockComposite.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      await POST(createRequest(), createParams());

      // 2 composite calls for creates (25 + 5)
      expect(mockComposite).toHaveBeenCalledTimes(2);

      const firstBatch = mockComposite.mock.calls[0][0];
      expect(firstBatch).toHaveLength(25);
      expect(firstBatch[0].referenceId).toBe("create_0");
      expect(firstBatch[24].referenceId).toBe("create_24");

      const secondBatch = mockComposite.mock.calls[1][0];
      expect(secondBatch).toHaveLength(5);
      expect(secondBatch[0].referenceId).toBe("create_25");
    });

    it("skips create when rule has no trigger conditions", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(
        makeRule({ triggerConditions: [] })
      );
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(body.created).toBe(0);
      // No composite calls at all (no deletes, no creates)
      expect(mockComposite).not.toHaveBeenCalled();
    });

    it("uses correct objectType and eventType from rule", async () => {
      const conditions = [makeCondition()];

      mockPrisma.routingRule.findFirst.mockResolvedValue(
        makeRule({
          triggerConditions: conditions,
          objectType: "CONTACT",
          triggerEvent: "BOTH",
        })
      );
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([]);
      mockComposite.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      await POST(createRequest(), createParams());

      const createCall = mockComposite.mock.calls[0][0];
      expect(createCall[0].body.Object_Type__c).toBe("CONTACT");
      expect(createCall[0].body.Event_Type__c).toBe("BOTH");
    });
  });

  // ── criteriaSyncedAt update ──────────────────────────────────────

  describe("criteriaSyncedAt update", () => {
    it("updates criteriaSyncedAt on the rule after sync", async () => {
      mockPrisma.routingRule.findFirst.mockResolvedValue(makeRule());
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      const beforeTime = new Date();
      await POST(createRequest(), createParams());

      expect(mockPrisma.routingRule.update).toHaveBeenCalledWith({
        where: { id: "rule-1" },
        data: { criteriaSyncedAt: expect.any(Date) },
      });

      const savedDate = mockPrisma.routingRule.update.mock.calls[0][0].data.criteriaSyncedAt;
      expect(savedDate.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    });
  });

  // ── Response format ──────────────────────────────────────────────

  describe("response format", () => {
    it("returns success response with counts and timestamp", async () => {
      const conditions = [makeCondition(), makeCondition({ id: "c2", sortOrder: 1 })];

      mockPrisma.routingRule.findFirst.mockResolvedValue(
        makeRule({ triggerConditions: conditions })
      );
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([{ Id: "existing-1" }]);
      mockComposite.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({
        success: true,
        deleted: 1,
        created: 2,
        syncedAt: expect.any(String),
      });

      // syncedAt should be a valid ISO date
      expect(() => new Date(body.syncedAt)).not.toThrow();
    });
  });

  // ── Error handling ───────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 with error message on unexpected errors", async () => {
      mockPrisma.routingRule.findFirst.mockRejectedValue(new Error("DB connection lost"));

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe("DB connection lost");
    });

    it("returns generic message for non-Error throws", async () => {
      mockPrisma.routingRule.findFirst.mockRejectedValue("string error");

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe("Internal server error");
    });
  });

  // ── Full flow: delete + create ───────────────────────────────────

  describe("full sync flow", () => {
    it("deletes old criteria then creates new ones in correct order", async () => {
      const conditions = [
        makeCondition({ id: "c1", groupId: "g1", fieldName: "Status", operator: "EQUALS", value: "Open", sortOrder: 0 }),
      ];

      mockPrisma.routingRule.findFirst.mockResolvedValue(
        makeRule({ triggerConditions: conditions })
      );
      setupOrg();
      setupDescribeSuccess();
      mockQuery.mockResolvedValue([{ Id: "old-1" }, { Id: "old-2" }]);
      mockComposite.mockResolvedValue([]);
      mockPrisma.routingRule.update.mockResolvedValue({});

      const res = await POST(createRequest(), createParams());
      const body = await res.json();

      expect(body.success).toBe(true);
      expect(body.deleted).toBe(2);
      expect(body.created).toBe(1);

      // composite called twice: once for deletes, once for creates
      expect(mockComposite).toHaveBeenCalledTimes(2);

      // First call = deletes
      const deleteCall = mockComposite.mock.calls[0][0];
      expect(deleteCall[0].method).toBe("DELETE");

      // Second call = creates
      const createCall = mockComposite.mock.calls[1][0];
      expect(createCall[0].method).toBe("POST");
      expect(createCall[0].body.Field_Name__c).toBe("Status");
    });
  });
});
