import { describe, it, expect, vi } from "vitest";
import { mockWebClient, mockLogger } from "../helpers";
import { handleListRules } from "../../src/tools/list-rules.js";
import { handleGetRule } from "../../src/tools/get-rule.js";
import { handleCreateRule } from "../../src/tools/create-rule.js";
import { handleUpdateRule } from "../../src/tools/update-rule.js";
import { handleDeleteRule } from "../../src/tools/delete-rule.js";
import { handleCloneRule } from "../../src/tools/clone-rule.js";
import { handleReorderRules } from "../../src/tools/reorder-rules.js";
import { handleTestRule } from "../../src/tools/test-rule.js";
import { handleRunScheduledRule } from "../../src/tools/run-scheduled-rule.js";

// ---------------------------------------------------------------------------
// list_rules
// ---------------------------------------------------------------------------
describe("handleListRules", () => {
  it("returns formatted summary for rules", async () => {
    const web = mockWebClient({
      listRules: vi.fn().mockResolvedValue({
        rules: [
          { id: "r1", name: "Enterprise", priority: 1, objectType: "LEAD", triggerEvent: "INSERT", status: "ACTIVE", conditions: [], branches: [] },
        ],
      }),
    });
    const logger = mockLogger();
    const res = await handleListRules(web, logger, {});
    expect(res.content[0].text).toContain("Enterprise");
    expect(logger.log).toHaveBeenCalled();
  });

  it("returns 'No routing rules' when empty", async () => {
    const web = mockWebClient({ listRules: vi.fn().mockResolvedValue({ rules: [] }) });
    const res = await handleListRules(web, mockLogger(), {});
    expect(res.content[0].text).toContain("No routing rules");
  });

  it("passes objectType filter", async () => {
    const web = mockWebClient();
    await handleListRules(web, mockLogger(), { objectType: "CONTACT" });
    expect(web.listRules).toHaveBeenCalledWith("CONTACT");
  });
});

// ---------------------------------------------------------------------------
// get_rule
// ---------------------------------------------------------------------------
describe("handleGetRule", () => {
  it("returns rule details", async () => {
    const web = mockWebClient({
      getRule: vi.fn().mockResolvedValue({
        rule: { id: "r1", name: "Test", objectType: "LEAD", triggerEvent: "INSERT", status: "ACTIVE", priority: 1 },
      }),
    });
    const res = await handleGetRule(web, mockLogger(), { ruleId: "r1" });
    expect(res.content[0].text).toContain("Test");
    expect(res.content[0].text).toContain("r1");
  });

  it("propagates error when API fails", async () => {
    const web = mockWebClient({
      getRule: vi.fn().mockRejectedValue(new Error("Not found")),
    });
    await expect(handleGetRule(web, mockLogger(), { ruleId: "bad" })).rejects.toThrow("Not found");
  });
});

// ---------------------------------------------------------------------------
// create_rule
// ---------------------------------------------------------------------------
describe("handleCreateRule", () => {
  const baseArgs = { name: "New", objectType: "LEAD", triggerEvent: "INSERT" };

  it("returns preview when confirm is false", async () => {
    const web = mockWebClient();
    const res = await handleCreateRule(web, mockLogger(), { ...baseArgs, confirm: false });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("New");
    expect(web.createRule).not.toHaveBeenCalled();
  });

  it("creates rule when confirm is true", async () => {
    const web = mockWebClient({
      createRule: vi.fn().mockResolvedValue({ rule: { id: "r1", name: "New" } }),
    });
    const res = await handleCreateRule(web, mockLogger(), { ...baseArgs, confirm: true });
    expect(res.content[0].text).toContain("Rule created");
    expect(web.createRule).toHaveBeenCalled();
  });

  it("auto-sets routeType=SCHEDULED for SEARCH rules", async () => {
    const web = mockWebClient({
      createRule: vi.fn().mockResolvedValue({ rule: { id: "r1", name: "Search" } }),
    });
    await handleCreateRule(web, mockLogger(), { name: "Search", objectType: "LEAD", triggerEvent: "SEARCH", confirm: true });
    expect(web.createRule).toHaveBeenCalledWith(expect.objectContaining({
      routeType: "SCHEDULED",
      scheduleFrequency: "ONE_TIME",
    }));
  });

  it("auto-sets routeType=REALTIME for INSERT rules", async () => {
    const web = mockWebClient({
      createRule: vi.fn().mockResolvedValue({ rule: { id: "r1", name: "RT" } }),
    });
    await handleCreateRule(web, mockLogger(), { name: "RT", objectType: "LEAD", triggerEvent: "INSERT", confirm: true });
    expect(web.createRule).toHaveBeenCalledWith(expect.objectContaining({
      routeType: "REALTIME",
    }));
  });

  it("auto-derives searchCriteria from branches for SEARCH rules", async () => {
    const web = mockWebClient({
      createRule: vi.fn().mockResolvedValue({ rule: { id: "r1", name: "Search" } }),
    });
    await handleCreateRule(web, mockLogger(), {
      name: "Search", objectType: "CONTACT", triggerEvent: "SEARCH",
      branches: [{
        label: "Old", conditions: [{ fieldName: "last_activity", fieldType: "DATE", operator: "before", value: "2026-01-01" }],
        assignmentType: "ROUND_ROBIN",
      }],
      confirm: true,
    });
    const callArgs = web.createRule.mock.calls[0][0];
    expect(callArgs.searchCriteria).toBeDefined();
    expect(callArgs.searchCriteria[0].conditions[0].fieldApiName).toBe("last_activity");
  });

  it("ensures groupIds and defaults on branch conditions", async () => {
    const web = mockWebClient({
      createRule: vi.fn().mockResolvedValue({ rule: { id: "r1", name: "Test" } }),
    });
    await handleCreateRule(web, mockLogger(), {
      name: "Test", objectType: "LEAD", triggerEvent: "INSERT",
      branches: [{
        label: "B1",
        conditions: [{ fieldName: "industry", operator: "equals", value: "Tech" }],
        assignmentType: "USER",
      }],
      confirm: true,
    });
    const callArgs = web.createRule.mock.calls[0][0];
    expect(callArgs.branches[0].conditions[0].groupId).toBe("g1");
    expect(callArgs.branches[0].conditions[0].fieldType).toBe("TEXT");
    expect(callArgs.branches[0].priority).toBe(0);
  });

  it("includes branch info in preview", async () => {
    const web = mockWebClient();
    const res = await handleCreateRule(web, mockLogger(), {
      ...baseArgs,
      branches: [{ label: "Enterprise", assignmentType: "ROUND_ROBIN", conditions: [{ fieldName: "Revenue", operator: "gte", value: "100000" }] }],
    });
    expect(res.content[0].text).toContain("Enterprise");
    expect(res.content[0].text).toContain("ROUND_ROBIN");
  });
});

// ---------------------------------------------------------------------------
// update_rule
// ---------------------------------------------------------------------------
describe("handleUpdateRule", () => {
  it("returns preview with diff when confirm is false", async () => {
    const web = mockWebClient({
      getRule: vi.fn().mockResolvedValue({ id: "r1", name: "Old", status: "ACTIVE" }),
    });
    const res = await handleUpdateRule(web, mockLogger(), { ruleId: "r1", name: "New", confirm: false });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Old");
    expect(res.content[0].text).toContain("New");
  });

  it("calls updateRule when confirmed", async () => {
    const web = mockWebClient({
      updateRule: vi.fn().mockResolvedValue({ id: "r1", name: "Updated" }),
    });
    const res = await handleUpdateRule(web, mockLogger(), { ruleId: "r1", name: "Updated", confirm: true });
    expect(res.content[0].text).toContain("Rule updated");
    expect(web.updateRule).toHaveBeenCalledWith("r1", expect.objectContaining({ name: "Updated" }));
  });

  it("auto-sets routeType=SCHEDULED for SEARCH triggerEvent", async () => {
    const web = mockWebClient({
      updateRule: vi.fn().mockResolvedValue({ id: "r1", name: "Search Rule" }),
    });
    await handleUpdateRule(web, mockLogger(), { ruleId: "r1", triggerEvent: "SEARCH", confirm: true });
    expect(web.updateRule).toHaveBeenCalledWith("r1", expect.objectContaining({
      routeType: "SCHEDULED",
      scheduleFrequency: "ONE_TIME",
    }));
  });

  it("auto-sets routeType=REALTIME for INSERT triggerEvent", async () => {
    const web = mockWebClient({
      updateRule: vi.fn().mockResolvedValue({ id: "r1", name: "RT Rule" }),
    });
    await handleUpdateRule(web, mockLogger(), { ruleId: "r1", triggerEvent: "INSERT", confirm: true });
    expect(web.updateRule).toHaveBeenCalledWith("r1", expect.objectContaining({
      routeType: "REALTIME",
    }));
  });

  it("auto-derives searchCriteria from branch conditions for SEARCH rules", async () => {
    const web = mockWebClient({
      updateRule: vi.fn().mockResolvedValue({ id: "r1", name: "Search" }),
    });
    await handleUpdateRule(web, mockLogger(), {
      ruleId: "r1",
      triggerEvent: "SEARCH",
      branches: [{
        label: "Stale",
        conditions: [{ fieldName: "last_activity", fieldType: "DATE", operator: "before", value: "2026-01-01" }],
        assignmentType: "ROUND_ROBIN",
      }],
      confirm: true,
    });
    const callArgs = web.updateRule.mock.calls[0][1];
    expect(callArgs.searchCriteria).toBeDefined();
    expect(callArgs.searchCriteria[0].conditions[0].fieldApiName).toBe("last_activity");
  });

  it("ensures groupIds on branch conditions", async () => {
    const web = mockWebClient({
      updateRule: vi.fn().mockResolvedValue({ id: "r1", name: "Updated" }),
    });
    await handleUpdateRule(web, mockLogger(), {
      ruleId: "r1",
      branches: [{
        label: "B1",
        conditions: [{ fieldName: "industry", operator: "equals", value: "Tech" }],
        assignmentType: "USER",
      }],
      confirm: true,
    });
    const callArgs = web.updateRule.mock.calls[0][1];
    expect(callArgs.branches[0].conditions[0].groupId).toBe("g1");
    expect(callArgs.branches[0].conditions[0].fieldType).toBe("TEXT");
    expect(callArgs.branches[0].priority).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// delete_rule
// ---------------------------------------------------------------------------
describe("handleDeleteRule", () => {
  it("returns preview showing rule details", async () => {
    const web = mockWebClient({
      getRule: vi.fn().mockResolvedValue({ name: "Target", objectType: "LEAD", status: "ACTIVE" }),
    });
    const res = await handleDeleteRule(web, mockLogger(), { ruleId: "r1" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Target");
  });

  it("deletes when confirmed", async () => {
    const web = mockWebClient();
    const res = await handleDeleteRule(web, mockLogger(), { ruleId: "r1", confirm: true });
    expect(res.content[0].text).toContain("deleted");
    expect(web.deleteRule).toHaveBeenCalledWith("r1");
  });
});

// ---------------------------------------------------------------------------
// clone_rule
// ---------------------------------------------------------------------------
describe("handleCloneRule", () => {
  it("returns preview of clone", async () => {
    const web = mockWebClient({
      getRule: vi.fn().mockResolvedValue({ name: "Source", objectType: "LEAD", triggerEvent: "INSERT" }),
    });
    const res = await handleCloneRule(web, mockLogger(), { ruleId: "r1" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Source");
  });

  it("clones when confirmed", async () => {
    const web = mockWebClient({
      cloneRule: vi.fn().mockResolvedValue({ rule: { id: "r2", name: "Copy" } }),
    });
    const res = await handleCloneRule(web, mockLogger(), { ruleId: "r1", confirm: true });
    expect(res.content[0].text).toContain("cloned");
    expect(web.cloneRule).toHaveBeenCalledWith("r1", {});
  });
});

// ---------------------------------------------------------------------------
// reorder_rules
// ---------------------------------------------------------------------------
describe("handleReorderRules", () => {
  it("returns preview with order", async () => {
    const web = mockWebClient();
    const res = await handleReorderRules(web, mockLogger(), { ruleIds: ["r1", "r2", "r3"] });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("3 rule(s)");
  });

  it("reorders when confirmed", async () => {
    const web = mockWebClient();
    const res = await handleReorderRules(web, mockLogger(), { ruleIds: ["r2", "r1"], confirm: true });
    expect(res.content[0].text).toContain("reordered");
    expect(web.reorderRules).toHaveBeenCalledWith(["r2", "r1"]);
  });
});

// ---------------------------------------------------------------------------
// test_rule
// ---------------------------------------------------------------------------
describe("handleTestRule", () => {
  it("returns match result", async () => {
    const web = mockWebClient({
      testRule: vi.fn().mockResolvedValue({ match: true, branch: { label: "Enterprise" } }),
    });
    const res = await handleTestRule(web, mockLogger(), { ruleId: "r1", fields: { Revenue: 500000 } });
    expect(res.content[0].text).toContain("YES");
    expect(res.content[0].text).toContain("Enterprise");
  });

  it("shows NO when no match", async () => {
    const web = mockWebClient({
      testRule: vi.fn().mockResolvedValue({ match: false }),
    });
    const res = await handleTestRule(web, mockLogger(), { ruleId: "r1", fields: { Revenue: 100 } });
    expect(res.content[0].text).toContain("NO");
  });
});

// ---------------------------------------------------------------------------
// run_scheduled_rule
// ---------------------------------------------------------------------------
describe("handleRunScheduledRule", () => {
  it("returns preview", async () => {
    const web = mockWebClient({
      getRule: vi.fn().mockResolvedValue({ name: "Nightly", objectType: "LEAD", status: "ACTIVE" }),
    });
    const res = await handleRunScheduledRule(web, mockLogger(), { ruleId: "r1" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Nightly");
  });

  it("triggers run when confirmed", async () => {
    const web = mockWebClient({
      runScheduledRule: vi.fn().mockResolvedValue({ run: { id: "run-1", status: "RUNNING" } }),
    });
    const res = await handleRunScheduledRule(web, mockLogger(), { ruleId: "r1", confirm: true });
    expect(res.content[0].text).toContain("triggered");
    expect(web.runScheduledRule).toHaveBeenCalledWith("r1");
  });
});
