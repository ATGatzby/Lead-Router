import { describe, it, expect } from "vitest";
import {
  setupTeamInput,
  setupRuleInput,
  syncCrmSchemaInput,
  importUsersInput,
  routeRecordInput,
  bulkRouteInput,
  retryFailedInput,
  toggleRoutingInput,
  rebalanceTeamInput,
  updateRuleCriteriaInput,
  reorderRulesInput,
  cloneAndModifyRuleInput,
  getPerformanceInput,
  getTeamWorkloadInput,
  exportReportInput,
} from "../src/schemas/inputs.js";

describe("setupTeamInput", () => {
  it("validates minimal input", () => {
    const result = setupTeamInput.safeParse({ name: "West Coast" });
    expect(result.success).toBe(true);
  });

  it("applies defaults", () => {
    const result = setupTeamInput.parse({ name: "Team A" });
    expect(result.strategy).toBe("round_robin");
  });

  it("rejects empty name", () => {
    const result = setupTeamInput.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("accepts full input with members and weights", () => {
    const result = setupTeamInput.safeParse({
      name: "Sales Team",
      description: "The sales crew",
      strategy: "weighted",
      members: ["a@b.com", "c@d.com"],
      weights: { "a@b.com": 60, "c@d.com": 40 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email in members", () => {
    const result = setupTeamInput.safeParse({
      name: "Team",
      members: ["not-an-email"],
    });
    expect(result.success).toBe(false);
  });
});

describe("setupRuleInput", () => {
  it("validates minimal input", () => {
    const result = setupRuleInput.safeParse({
      name: "Route Leads",
      objectType: "LEAD",
      assignTo: { teamId: "t1" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts HubSpot object types", () => {
    const result = setupRuleInput.safeParse({
      name: "Route Companies",
      objectType: "COMPANY",
      assignTo: { userId: "u1" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid object type", () => {
    const result = setupRuleInput.safeParse({
      name: "Test",
      objectType: "INVALID",
      assignTo: {},
    });
    expect(result.success).toBe(false);
  });

  it("applies default triggerEvent and activate", () => {
    const result = setupRuleInput.parse({
      name: "Test",
      objectType: "LEAD",
      assignTo: { teamId: "t1" },
    });
    expect(result.triggerEvent).toBe("INSERT");
    expect(result.activate).toBe(true);
  });
});

describe("syncCrmSchemaInput", () => {
  it("accepts empty object", () => {
    const result = syncCrmSchemaInput.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts object types array", () => {
    const result = syncCrmSchemaInput.safeParse({
      objectTypes: ["LEAD", "CONTACT"],
    });
    expect(result.success).toBe(true);
  });
});

describe("importUsersInput", () => {
  it("validates with defaults", () => {
    const result = importUsersInput.parse({});
    expect(result.autoLicense).toBe(false);
  });
});

describe("routeRecordInput", () => {
  it("validates complete input", () => {
    const result = routeRecordInput.safeParse({
      objectType: "LEAD",
      recordId: "001xxx",
      fields: { Email: "test@example.com" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing recordId", () => {
    const result = routeRecordInput.safeParse({
      objectType: "LEAD",
      fields: {},
    });
    expect(result.success).toBe(false);
  });
});

describe("bulkRouteInput", () => {
  it("validates batch records", () => {
    const result = bulkRouteInput.safeParse({
      objectType: "CONTACT",
      records: [
        { recordId: "r1", fields: { Name: "A" } },
        { recordId: "r2", fields: { Name: "B" } },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("retryFailedInput", () => {
  it("applies default limit", () => {
    const result = retryFailedInput.parse({});
    expect(result.limit).toBe(100);
  });
});

describe("toggleRoutingInput", () => {
  it("requires objectType and mode", () => {
    const result = toggleRoutingInput.safeParse({
      objectType: "LEAD",
      mode: "CLASSIC",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid mode", () => {
    const result = toggleRoutingInput.safeParse({
      objectType: "LEAD",
      mode: "INVALID",
    });
    expect(result.success).toBe(false);
  });
});

describe("rebalanceTeamInput", () => {
  it("applies default strategy", () => {
    const result = rebalanceTeamInput.parse({ teamId: "t1" });
    expect(result.strategy).toBe("equalize");
  });
});

describe("updateRuleCriteriaInput", () => {
  it("validates criteria array", () => {
    const result = updateRuleCriteriaInput.safeParse({
      ruleId: "r1",
      criteria: [{ field: "Industry", operator: "equals", value: "Tech" }],
    });
    expect(result.success).toBe(true);
  });
});

describe("reorderRulesInput", () => {
  it("requires non-empty ruleIds", () => {
    const result = reorderRulesInput.safeParse({
      objectType: "LEAD",
      ruleIds: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("cloneAndModifyRuleInput", () => {
  it("accepts minimal input", () => {
    const result = cloneAndModifyRuleInput.safeParse({
      sourceRuleId: "r1",
    });
    expect(result.success).toBe(true);
  });
});

describe("getPerformanceInput", () => {
  it("accepts empty input", () => {
    const result = getPerformanceInput.safeParse({});
    expect(result.success).toBe(true);
  });
});

describe("getTeamWorkloadInput", () => {
  it("accepts optional teamId", () => {
    const result = getTeamWorkloadInput.safeParse({ teamId: "t1" });
    expect(result.success).toBe(true);
  });
});

describe("exportReportInput", () => {
  it("requires date range", () => {
    const result = exportReportInput.safeParse({
      fromDate: "2026-01-01T00:00:00Z",
      toDate: "2026-01-31T23:59:59Z",
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults", () => {
    const result = exportReportInput.parse({
      fromDate: "2026-01-01T00:00:00Z",
      toDate: "2026-01-31T23:59:59Z",
    });
    expect(result.format).toBe("csv");
    expect(result.limit).toBe(5000);
  });
});
