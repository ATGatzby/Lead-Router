import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all query functions
const mocks = vi.hoisted(() => ({
  queryRoutingLogs: vi.fn().mockResolvedValue([]),
  getRulePerformance: vi.fn().mockResolvedValue([]),
  getTeamWorkload: vi.fn().mockResolvedValue([]),
  getConversionMetrics: vi.fn().mockResolvedValue([]),
  getTrendData: vi.fn().mockResolvedValue([]),
  listRules: vi.fn().mockResolvedValue([]),
  getAssigneeStats: vi.fn().mockResolvedValue([]),
  explainRule: vi.fn().mockResolvedValue(null),
  getRoutingTimeline: vi.fn().mockResolvedValue([]),
  listTeams: vi.fn().mockResolvedValue([]),
  listUsers: vi.fn().mockResolvedValue([]),
  queryAuditLogs: vi.fn().mockResolvedValue([]),
  listQueues: vi.fn().mockResolvedValue([]),
  queryCompanyAliases: vi.fn().mockResolvedValue([]),
  listFields: vi.fn().mockResolvedValue([]),
  getOrgSettings: vi.fn().mockResolvedValue({}),
  listAppUsers: vi.fn().mockResolvedValue([]),
  listInvites: vi.fn().mockResolvedValue([]),
  getBillingInfo: vi.fn().mockResolvedValue(null),
  listSessions: vi.fn().mockResolvedValue([]),
  getBranchPerformance: vi.fn().mockResolvedValue([]),
}));

vi.mock("./queries", () => mocks);

import { TOOLS, toolsToOpenAI, executeTool } from "./tools";

const ORG_ID = "org_test_123";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TOOLS", () => {
  it("has exactly 21 tool definitions", () => {
    expect(TOOLS).toHaveLength(21);
  });

  it("every tool has name, description, and input_schema", () => {
    for (const tool of TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.input_schema).toBeDefined();
      expect(tool.input_schema.type).toBe("object");
    }
  });

  it("all tool names are unique", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("toolsToOpenAI", () => {
  it("converts to OpenAI function calling format", () => {
    const converted = toolsToOpenAI(TOOLS);
    expect(converted).toHaveLength(21);
    for (const entry of converted) {
      expect(entry.type).toBe("function");
      expect(entry.function.name).toBeTruthy();
      expect(entry.function.description).toBeTruthy();
      expect(entry.function.parameters).toBeDefined();
    }
  });
});

describe("executeTool", () => {
  const toolDispatchMap: Array<{ tool: string; mock: keyof typeof mocks; args: Record<string, unknown> }> = [
    { tool: "query_routing_logs", mock: "queryRoutingLogs", args: { status: "SUCCESS" } },
    { tool: "get_rule_performance", mock: "getRulePerformance", args: { dateFrom: "2026-01-01" } },
    { tool: "get_team_workload", mock: "getTeamWorkload", args: {} },
    { tool: "get_conversion_metrics", mock: "getConversionMetrics", args: {} },
    { tool: "get_trend_data", mock: "getTrendData", args: { ruleId: "r1" } },
    { tool: "list_rules", mock: "listRules", args: { status: "ACTIVE" } },
    { tool: "get_assignee_stats", mock: "getAssigneeStats", args: {} },
    { tool: "explain_rule", mock: "explainRule", args: { ruleId: "r1" } },
    { tool: "get_routing_timeline", mock: "getRoutingTimeline", args: { crmRecordId: "00Q123" } },
    { tool: "list_teams", mock: "listTeams", args: { teamId: "t1" } },
    { tool: "list_users", mock: "listUsers", args: { isLicensed: true } },
    { tool: "query_audit_logs", mock: "queryAuditLogs", args: { action: "RULE_CREATED" } },
    { tool: "list_queues", mock: "listQueues", args: {} },
    { tool: "query_company_aliases", mock: "queryCompanyAliases", args: { name: "Acme" } },
    { tool: "list_fields", mock: "listFields", args: { objectType: "LEAD" } },
    { tool: "get_org_settings", mock: "getOrgSettings", args: {} },
    { tool: "list_app_users", mock: "listAppUsers", args: { role: "ADMIN" } },
    { tool: "list_invites", mock: "listInvites", args: { status: "pending" } },
    { tool: "get_billing_info", mock: "getBillingInfo", args: {} },
    { tool: "get_branch_performance", mock: "getBranchPerformance", args: { ruleId: "r1" } },
    { tool: "list_sessions", mock: "listSessions", args: { activeOnly: true } },
  ];

  it.each(toolDispatchMap)("dispatches $tool to the correct query function", async ({ tool, mock, args }) => {
    const expected = { data: tool };
    mocks[mock].mockResolvedValueOnce(expected);
    const result = await executeTool(tool, args, ORG_ID);
    expect(result).toEqual(expected);
    expect(mocks[mock]).toHaveBeenCalledTimes(1);
  });

  it("passes orgId as first argument to all tools", async () => {
    await executeTool("list_queues", {}, ORG_ID);
    expect(mocks.listQueues).toHaveBeenCalledWith(ORG_ID);

    await executeTool("get_org_settings", {}, ORG_ID);
    expect(mocks.getOrgSettings).toHaveBeenCalledWith(ORG_ID);

    await executeTool("get_billing_info", {}, ORG_ID);
    expect(mocks.getBillingInfo).toHaveBeenCalledWith(ORG_ID);
  });

  it("passes ruleId directly for explain_rule", async () => {
    await executeTool("explain_rule", { ruleId: "rule_abc" }, ORG_ID);
    expect(mocks.explainRule).toHaveBeenCalledWith(ORG_ID, "rule_abc");
  });

  it("passes crmRecordId directly for get_routing_timeline", async () => {
    await executeTool("get_routing_timeline", { crmRecordId: "00Q999" }, ORG_ID);
    expect(mocks.getRoutingTimeline).toHaveBeenCalledWith(ORG_ID, "00Q999");
  });

  it("throws for unknown tool", async () => {
    await expect(executeTool("nonexistent_tool", {}, ORG_ID)).rejects.toThrow("Unknown tool: nonexistent_tool");
  });
});
