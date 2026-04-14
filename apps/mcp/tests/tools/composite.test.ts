import { describe, it, expect, vi } from "vitest";
import { mockWebClient, mockLogger } from "../helpers";
import { handleSetupTeamComposite } from "../../src/tools/composite/setup-team.js";
import { handleSetupRuleComposite } from "../../src/tools/composite/setup-rule.js";
import { handleSyncCrmComposite } from "../../src/tools/composite/sync-crm.js";
import { handleImportUsersComposite } from "../../src/tools/composite/import-users.js";
import { handleRouteRecordComposite } from "../../src/tools/composite/route-record.js";
import { handleBulkRouteComposite } from "../../src/tools/composite/bulk-route.js";
import { handleRetryFailedComposite } from "../../src/tools/composite/retry-failed.js";
import { handleToggleRoutingComposite } from "../../src/tools/composite/toggle-routing.js";
import { handleRebalanceTeamComposite } from "../../src/tools/composite/rebalance-team.js";
import { handleUpdateRuleCriteriaComposite } from "../../src/tools/composite/update-rule-criteria.js";
import { handleReorderRulesComposite } from "../../src/tools/composite/reorder-rules.js";
import { handleCloneModifyRuleComposite } from "../../src/tools/composite/clone-modify-rule.js";
import { handleGetRoutingStatusComposite } from "../../src/tools/composite/get-routing-status.js";
import { handleGetPerformanceComposite } from "../../src/tools/composite/get-performance.js";
import { handleGetTeamWorkloadComposite } from "../../src/tools/composite/get-team-workload.js";
import { handleExportReportComposite } from "../../src/tools/composite/export-report.js";

// ---------------------------------------------------------------------------
// Helpers to build standard composite API responses
// ---------------------------------------------------------------------------
function successResult(overrides: Partial<{
  data: any;
  actions_taken: string[];
  warnings: string[];
  next_actions: Array<{ action: string; reason: string }>;
}> = {}) {
  return {
    success: true,
    data: overrides.data ?? {},
    actions_taken: overrides.actions_taken ?? ["Action completed"],
    warnings: overrides.warnings ?? [],
    next_actions: overrides.next_actions ?? [],
  };
}

function errorResult(message = "Something went wrong", remediation = "Try again") {
  return {
    success: false,
    error: { code: "VALIDATION", message, remediation },
  };
}

// ---------------------------------------------------------------------------
// setup_team
// ---------------------------------------------------------------------------
describe("handleSetupTeamComposite", () => {
  it("formats successful response with actions_taken", async () => {
    const web = mockWebClient({
      v1SetupTeam: vi.fn().mockResolvedValue(
        successResult({
          data: { team_id: "t1", name: "West Coast" },
          actions_taken: ["Created team", "Added 2 members"],
          next_actions: [{ action: "setup_routing_rule", reason: "Create a rule for this team" }],
        }),
      ),
    });
    const result = await handleSetupTeamComposite(web, mockLogger(), { name: "West Coast" });
    expect(result.content[0].text).toContain("Created team");
    expect(result.content[0].text).toContain("Added 2 members");
    expect(result.content[0].text).toContain("setup_routing_rule");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1SetupTeam: vi.fn().mockResolvedValue(errorResult("Name required", "Provide a name")),
    });
    const result = await handleSetupTeamComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Name required");
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1SetupTeam: vi.fn().mockRejectedValue(new Error("API error (403): agent scope required")),
    });
    const result = await handleSetupTeamComposite(web, mockLogger(), { name: "Test" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });

  it("includes warnings when present", async () => {
    const web = mockWebClient({
      v1SetupTeam: vi.fn().mockResolvedValue(
        successResult({
          actions_taken: ["Created team"],
          warnings: ["Member alice@co.com not found"],
        }),
      ),
    });
    const result = await handleSetupTeamComposite(web, mockLogger(), { name: "Team" });
    expect(result.content[0].text).toContain("alice@co.com not found");
  });
});

// ---------------------------------------------------------------------------
// setup_routing_rule
// ---------------------------------------------------------------------------
describe("handleSetupRuleComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1SetupRoutingRule: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Created rule 'Enterprise Leads'", "Added 2 conditions"] }),
      ),
    });
    const result = await handleSetupRuleComposite(web, mockLogger(), { name: "Enterprise Leads", objectType: "LEAD" });
    expect(result.content[0].text).toContain("Enterprise Leads");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1SetupRoutingRule: vi.fn().mockResolvedValue(errorResult("Invalid object type")),
    });
    const result = await handleSetupRuleComposite(web, mockLogger(), { name: "X", objectType: "BAD" });
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1SetupRoutingRule: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleSetupRuleComposite(web, mockLogger(), { name: "Test", objectType: "LEAD" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// sync_crm
// ---------------------------------------------------------------------------
describe("handleSyncCrmComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1SyncCrm: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Synced 50 users", "Synced 120 fields", "Synced 3 queues"] }),
      ),
    });
    const result = await handleSyncCrmComposite(web, mockLogger(), {});
    expect(result.content[0].text).toContain("Synced 50 users");
    expect(result.content[0].text).toContain("Synced 120 fields");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1SyncCrm: vi.fn().mockResolvedValue(errorResult("CRM not connected")),
    });
    const result = await handleSyncCrmComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1SyncCrm: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleSyncCrmComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// import_users
// ---------------------------------------------------------------------------
describe("handleImportUsersComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1ImportUsers: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Imported 5 users by role", "Licensed 5 users"] }),
      ),
    });
    const result = await handleImportUsersComposite(web, mockLogger(), { by: "role", value: "Sales Rep" });
    expect(result.content[0].text).toContain("Imported 5 users");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1ImportUsers: vi.fn().mockResolvedValue(errorResult("No users found for role")),
    });
    const result = await handleImportUsersComposite(web, mockLogger(), { by: "role", value: "Nonexistent" });
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1ImportUsers: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleImportUsersComposite(web, mockLogger(), { by: "role", value: "test" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// route_record
// ---------------------------------------------------------------------------
describe("handleRouteRecordComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1RouteRecord: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Matched rule 'Enterprise'", "Assigned to alice@co.com"] }),
      ),
    });
    const result = await handleRouteRecordComposite(web, mockLogger(), { objectType: "LEAD", recordId: "00Q1" });
    expect(result.content[0].text).toContain("Matched rule");
    expect(result.content[0].text).toContain("alice@co.com");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1RouteRecord: vi.fn().mockResolvedValue(errorResult("Record not found")),
    });
    const result = await handleRouteRecordComposite(web, mockLogger(), { objectType: "LEAD", recordId: "bad" });
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1RouteRecord: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleRouteRecordComposite(web, mockLogger(), { objectType: "LEAD", recordId: "00Q1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// bulk_route
// ---------------------------------------------------------------------------
describe("handleBulkRouteComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1BulkRoute: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Routed 10 records", "2 failures"] }),
      ),
    });
    const result = await handleBulkRouteComposite(web, mockLogger(), {
      objectType: "LEAD",
      records: [{ recordId: "00Q1" }],
    });
    expect(result.content[0].text).toContain("Routed 10 records");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1BulkRoute: vi.fn().mockResolvedValue(errorResult("No records provided")),
    });
    const result = await handleBulkRouteComposite(web, mockLogger(), { objectType: "LEAD", records: [] });
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1BulkRoute: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleBulkRouteComposite(web, mockLogger(), { objectType: "LEAD", records: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// retry_failed
// ---------------------------------------------------------------------------
describe("handleRetryFailedComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1RetryFailed: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Retried 15 failed assignments", "12 succeeded, 3 still failing"] }),
      ),
    });
    const result = await handleRetryFailedComposite(web, mockLogger(), { scope: "all" });
    expect(result.content[0].text).toContain("Retried 15");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1RetryFailed: vi.fn().mockResolvedValue(errorResult("No failed assignments")),
    });
    const result = await handleRetryFailedComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1RetryFailed: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleRetryFailedComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// toggle_routing
// ---------------------------------------------------------------------------
describe("handleToggleRoutingComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1ToggleRouting: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Disabled routing for all 5 rules"] }),
      ),
    });
    const result = await handleToggleRoutingComposite(web, mockLogger(), { action: "disable" });
    expect(result.content[0].text).toContain("Disabled routing");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1ToggleRouting: vi.fn().mockResolvedValue(errorResult("Invalid action")),
    });
    const result = await handleToggleRoutingComposite(web, mockLogger(), { action: "bad" });
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1ToggleRouting: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleToggleRoutingComposite(web, mockLogger(), { action: "enable" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// rebalance_team
// ---------------------------------------------------------------------------
describe("handleRebalanceTeamComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1RebalanceTeam: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Set equal weights for 4 members", "Reset round-robin pointer"] }),
      ),
    });
    const result = await handleRebalanceTeamComposite(web, mockLogger(), { teamId: "t1" });
    expect(result.content[0].text).toContain("equal weights");
    expect(result.content[0].text).toContain("round-robin");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1RebalanceTeam: vi.fn().mockResolvedValue(errorResult("Team not found")),
    });
    const result = await handleRebalanceTeamComposite(web, mockLogger(), { teamId: "bad" });
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1RebalanceTeam: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleRebalanceTeamComposite(web, mockLogger(), { teamId: "t1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// update_rule_criteria
// ---------------------------------------------------------------------------
describe("handleUpdateRuleCriteriaComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1UpdateRuleCriteria: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Updated 3 entry conditions", "Validated against CRM fields"] }),
      ),
    });
    const result = await handleUpdateRuleCriteriaComposite(web, mockLogger(), { ruleId: "r1" });
    expect(result.content[0].text).toContain("Updated 3 entry conditions");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1UpdateRuleCriteria: vi.fn().mockResolvedValue(errorResult("Rule not found")),
    });
    const result = await handleUpdateRuleCriteriaComposite(web, mockLogger(), { ruleId: "bad" });
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1UpdateRuleCriteria: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleUpdateRuleCriteriaComposite(web, mockLogger(), { ruleId: "r1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// reorder_rules_composite
// ---------------------------------------------------------------------------
describe("handleReorderRulesComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1ReorderRules: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Reordered 3 rules", "New order: Enterprise > SMB > Default"] }),
      ),
    });
    const result = await handleReorderRulesComposite(web, mockLogger(), { ruleIds: ["r1", "r2", "r3"] });
    expect(result.content[0].text).toContain("Reordered 3 rules");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1ReorderRules: vi.fn().mockResolvedValue(errorResult("Invalid rule IDs")),
    });
    const result = await handleReorderRulesComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1ReorderRules: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleReorderRulesComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// clone_modify_rule
// ---------------------------------------------------------------------------
describe("handleCloneModifyRuleComposite", () => {
  it("formats successful response", async () => {
    const web = mockWebClient({
      v1CloneModifyRule: vi.fn().mockResolvedValue(
        successResult({ actions_taken: ["Cloned rule 'Enterprise'", "Applied 2 modifications", "New rule ID: r2"] }),
      ),
    });
    const result = await handleCloneModifyRuleComposite(web, mockLogger(), { sourceRuleId: "r1" });
    expect(result.content[0].text).toContain("Cloned rule");
    expect(result.content[0].text).toContain("r2");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1CloneModifyRule: vi.fn().mockResolvedValue(errorResult("Source rule not found")),
    });
    const result = await handleCloneModifyRuleComposite(web, mockLogger(), { sourceRuleId: "bad" });
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1CloneModifyRule: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleCloneModifyRuleComposite(web, mockLogger(), { sourceRuleId: "r1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// get_routing_status
// ---------------------------------------------------------------------------
describe("handleGetRoutingStatusComposite", () => {
  it("formats successful response with data", async () => {
    const web = mockWebClient({
      v1GetRoutingStatus: vi.fn().mockResolvedValue(
        successResult({
          actions_taken: ["Fetched routing status"],
          data: { activeRules: 3, teams: 2, crmConnected: true },
        }),
      ),
    });
    const result = await handleGetRoutingStatusComposite(web, mockLogger(), {});
    expect(result.content[0].text).toContain("Fetched routing status");
    expect(result.content[0].text).toContain("activeRules");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1GetRoutingStatus: vi.fn().mockResolvedValue(errorResult("Unauthorized")),
    });
    const result = await handleGetRoutingStatusComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1GetRoutingStatus: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleGetRoutingStatusComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// get_performance
// ---------------------------------------------------------------------------
describe("handleGetPerformanceComposite", () => {
  it("formats successful response with data", async () => {
    const web = mockWebClient({
      v1GetPerformance: vi.fn().mockResolvedValue(
        successResult({
          actions_taken: ["Collected performance metrics"],
          data: { throughput: 120, avgLatencyMs: 35, successRate: 98.5 },
        }),
      ),
    });
    const result = await handleGetPerformanceComposite(web, mockLogger(), { period: "24h" });
    expect(result.content[0].text).toContain("performance metrics");
    expect(result.content[0].text).toContain("throughput");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1GetPerformance: vi.fn().mockResolvedValue(errorResult("No data available")),
    });
    const result = await handleGetPerformanceComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1GetPerformance: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleGetPerformanceComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// get_team_workload
// ---------------------------------------------------------------------------
describe("handleGetTeamWorkloadComposite", () => {
  it("formats successful response with data", async () => {
    const web = mockWebClient({
      v1GetTeamWorkload: vi.fn().mockResolvedValue(
        successResult({
          actions_taken: ["Collected team workload data"],
          data: { teams: [{ name: "West Coast", members: 4, totalAssigned: 120 }] },
        }),
      ),
    });
    const result = await handleGetTeamWorkloadComposite(web, mockLogger(), {});
    expect(result.content[0].text).toContain("workload");
    expect(result.content[0].text).toContain("West Coast");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1GetTeamWorkload: vi.fn().mockResolvedValue(errorResult("No teams found")),
    });
    const result = await handleGetTeamWorkloadComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1GetTeamWorkload: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleGetTeamWorkloadComposite(web, mockLogger(), {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });
});

// ---------------------------------------------------------------------------
// export_report
// ---------------------------------------------------------------------------
describe("handleExportReportComposite", () => {
  it("formats successful response with data", async () => {
    const web = mockWebClient({
      v1ExportReport: vi.fn().mockResolvedValue(
        successResult({
          actions_taken: ["Generated routing summary report"],
          data: { totalRouted: 500, successRate: 94.2, topRule: "Enterprise" },
        }),
      ),
    });
    const result = await handleExportReportComposite(web, mockLogger(), { reportType: "routing_summary" });
    expect(result.content[0].text).toContain("routing summary");
    expect(result.content[0].text).toContain("totalRouted");
  });

  it("formats error response", async () => {
    const web = mockWebClient({
      v1ExportReport: vi.fn().mockResolvedValue(errorResult("Invalid report type")),
    });
    const result = await handleExportReportComposite(web, mockLogger(), { reportType: "bad" });
    expect(result.isError).toBe(true);
  });

  it("handles 403 agent scope error", async () => {
    const web = mockWebClient({
      v1ExportReport: vi.fn().mockRejectedValue(new Error("API error (403): agent scope")),
    });
    const result = await handleExportReportComposite(web, mockLogger(), { reportType: "routing_summary" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("agent");
  });

  it("handles string data (CSV format)", async () => {
    const web = mockWebClient({
      v1ExportReport: vi.fn().mockResolvedValue(
        successResult({
          actions_taken: ["Generated CSV report"],
          data: "recordId,owner,rule\n00Q1,alice,Enterprise",
        }),
      ),
    });
    const result = await handleExportReportComposite(web, mockLogger(), { reportType: "routing_summary", format: "csv" });
    expect(result.content[0].text).toContain("recordId,owner,rule");
  });
});
