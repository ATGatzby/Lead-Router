import { describe, it, expect, vi } from "vitest";
import { evaluateRuleDetailed, type EvalCondition } from "./evaluator.js";

// Mock external dependencies
vi.mock("./lib/ai-client.js", () => ({
  resolveCompanySimilarity: vi.fn().mockResolvedValue(null),
}));

vi.mock("./lib/alias-cache.js", () => ({
  checkAliasCache: vi.fn().mockResolvedValue(null),
  cacheAliasResult: vi.fn().mockResolvedValue(undefined),
}));

function cond(
  operator: string,
  fieldName: string,
  value: string | null,
  groupId = "g1"
): EvalCondition {
  return { groupId, fieldName, operator, value };
}

// ─── evaluateRuleDetailed ──────────────────────────────────────────────────

describe("evaluateRuleDetailed — zero conditions (catch-all)", () => {
  it("returns matched: true with empty groups array", async () => {
    const result = await evaluateRuleDetailed({}, []);
    expect(result).toEqual({ matched: true, groups: [] });
  });
});

describe("evaluateRuleDetailed — single group, all pass", () => {
  it("returns matched: true with correct condition detail", async () => {
    const conditions: EvalCondition[] = [
      cond("equals", "LeadSource", "Web", "g1"),
      cond("contains", "Company", "tech", "g1"),
    ];
    const record = { LeadSource: "Web", Company: "TechCorp" };
    const result = await evaluateRuleDetailed(record, conditions);

    expect(result.matched).toBe(true);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].groupId).toBe("g1");
    expect(result.groups[0].groupMatched).toBe(true);
    expect(result.groups[0].conditions).toHaveLength(2);
    expect(result.groups[0].conditions[0]).toEqual({
      fieldName: "LeadSource",
      operator: "equals",
      expectedValue: "Web",
      actualValue: "Web",
      passed: true,
    });
    expect(result.groups[0].conditions[1]).toEqual({
      fieldName: "Company",
      operator: "contains",
      expectedValue: "tech",
      actualValue: "TechCorp",
      passed: true,
    });
  });
});

describe("evaluateRuleDetailed — single group, one fails", () => {
  it("returns matched: false with pass/fail detail per condition", async () => {
    const conditions: EvalCondition[] = [
      cond("equals", "LeadSource", "Web", "g1"),
      cond("equals", "Industry", "Technology", "g1"),
    ];
    const record = { LeadSource: "Web", Industry: "Banking" };
    const result = await evaluateRuleDetailed(record, conditions);

    expect(result.matched).toBe(false);
    expect(result.groups[0].groupMatched).toBe(false);
    expect(result.groups[0].conditions[0].passed).toBe(true);
    expect(result.groups[0].conditions[1].passed).toBe(false);
    expect(result.groups[0].conditions[1].actualValue).toBe("Banking");
    expect(result.groups[0].conditions[1].expectedValue).toBe("Technology");
  });
});

describe("evaluateRuleDetailed — OR between groups", () => {
  it("matches when second group passes", async () => {
    const conditions: EvalCondition[] = [
      cond("equals", "LeadSource", "Web", "g1"),
      cond("equals", "LeadSource", "API", "g2"),
    ];
    const result = await evaluateRuleDetailed(
      { LeadSource: "API" },
      conditions
    );

    expect(result.matched).toBe(true);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].groupMatched).toBe(false);
    expect(result.groups[1].groupMatched).toBe(true);
  });

  it("does not match when no group passes", async () => {
    const conditions: EvalCondition[] = [
      cond("equals", "LeadSource", "Web", "g1"),
      cond("equals", "LeadSource", "API", "g2"),
    ];
    const result = await evaluateRuleDetailed(
      { LeadSource: "Email" },
      conditions
    );

    expect(result.matched).toBe(false);
    expect(result.groups[0].groupMatched).toBe(false);
    expect(result.groups[1].groupMatched).toBe(false);
  });
});

describe("evaluateRuleDetailed — actual value capture", () => {
  it("captures null for missing fields", async () => {
    const result = await evaluateRuleDetailed(
      {},
      [cond("equals", "Phone", "555-1234")]
    );

    expect(result.groups[0].conditions[0].actualValue).toBeNull();
    expect(result.groups[0].conditions[0].passed).toBe(false);
  });

  it("captures numeric values as strings", async () => {
    const result = await evaluateRuleDetailed(
      { AnnualRevenue: 5000000 },
      [cond("gt", "AnnualRevenue", "1000000")]
    );

    expect(result.groups[0].conditions[0].actualValue).toBe("5000000");
    expect(result.groups[0].conditions[0].passed).toBe(true);
  });

  it("truncates very long values to 200 chars", async () => {
    const longValue = "A".repeat(300);
    const result = await evaluateRuleDetailed(
      { Description: longValue },
      [cond("contains", "Description", "A")]
    );

    expect(result.groups[0].conditions[0].actualValue!.length).toBe(200);
  });
});

describe("evaluateRuleDetailed — field name case normalization", () => {
  it("matches lowercase SFDC field key against Pascal-case condition", async () => {
    const result = await evaluateRuleDetailed(
      { leadsource: "Web" },
      [cond("equals", "LeadSource", "Web")]
    );

    expect(result.matched).toBe(true);
    expect(result.groups[0].conditions[0].actualValue).toBe("Web");
  });
});

describe("evaluateRuleDetailed — null expected value", () => {
  it("is_blank operator returns null as expectedValue", async () => {
    const result = await evaluateRuleDetailed(
      { Phone: null },
      [cond("is_blank", "Phone", null)]
    );

    expect(result.groups[0].conditions[0].expectedValue).toBeNull();
    expect(result.groups[0].conditions[0].passed).toBe(true);
  });
});
