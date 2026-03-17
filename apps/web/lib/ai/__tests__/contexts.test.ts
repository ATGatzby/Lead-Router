import { describe, it, expect } from "vitest";

// We import getToolsForContext from the tools module (where it's exported)
// and the context constants from contexts
import { getToolsForContext } from "../tools";
import { CONTEXT_READ_TOOLS, CONTEXT_PROMPTS, type AgentContext } from "../contexts";
import { MUTATION_TOOLS } from "../mutation-tools";

const ALL_CONTEXTS: AgentContext[] = ["license-users", "teams", "routing-rules", "global"];

describe("getToolsForContext", () => {
  describe("license-users context", () => {
    const tools = getToolsForContext("license-users");
    const toolNames = tools.map((t) => t.name);

    it("returns only license-relevant read tools", () => {
      const expectedReadTools = CONTEXT_READ_TOOLS["license-users"];
      for (const name of expectedReadTools) {
        expect(toolNames).toContain(name);
      }
    });

    it("includes license mutation tools", () => {
      expect(toolNames).toContain("license_users");
      expect(toolNames).toContain("delicense_users");
    });

    it("does not include team-only or rule-only mutation tools", () => {
      expect(toolNames).not.toContain("create_rule");
      expect(toolNames).not.toContain("toggle_rule");
      expect(toolNames).not.toContain("delete_rule");
      expect(toolNames).not.toContain("create_team");
      expect(toolNames).not.toContain("delete_team");
    });
  });

  describe("teams context", () => {
    const tools = getToolsForContext("teams");
    const toolNames = tools.map((t) => t.name);

    it("returns team-relevant read tools", () => {
      const expectedReadTools = CONTEXT_READ_TOOLS["teams"];
      for (const name of expectedReadTools) {
        expect(toolNames).toContain(name);
      }
    });

    it("includes team mutation tools", () => {
      expect(toolNames).toContain("create_team");
      expect(toolNames).toContain("update_team");
      expect(toolNames).toContain("delete_team");
      expect(toolNames).toContain("manage_team_members");
      expect(toolNames).toContain("update_team_weights");
    });

    it("does not include license or rule mutation tools", () => {
      expect(toolNames).not.toContain("license_users");
      expect(toolNames).not.toContain("delicense_users");
      expect(toolNames).not.toContain("create_rule");
      expect(toolNames).not.toContain("toggle_rule");
      expect(toolNames).not.toContain("delete_rule");
    });
  });

  describe("routing-rules context", () => {
    const tools = getToolsForContext("routing-rules");
    const toolNames = tools.map((t) => t.name);

    it("returns rule-relevant read tools", () => {
      const expectedReadTools = CONTEXT_READ_TOOLS["routing-rules"];
      for (const name of expectedReadTools) {
        expect(toolNames).toContain(name);
      }
    });

    it("includes rule mutation tools", () => {
      expect(toolNames).toContain("create_rule");
      expect(toolNames).toContain("toggle_rule");
      expect(toolNames).toContain("delete_rule");
    });

    it("does not include license or team mutation tools", () => {
      expect(toolNames).not.toContain("license_users");
      expect(toolNames).not.toContain("delicense_users");
      expect(toolNames).not.toContain("create_team");
      expect(toolNames).not.toContain("delete_team");
    });
  });

  describe("global context", () => {
    const tools = getToolsForContext("global");
    const toolNames = tools.map((t) => t.name);

    it("returns ALL read tools (since CONTEXT_READ_TOOLS[global] is empty)", () => {
      // global context gets all read tools because its allowedReadTools list is empty
      expect(CONTEXT_READ_TOOLS["global"]).toEqual([]);
      // Should include tools from every other context
      expect(toolNames).toContain("list_users");
      expect(toolNames).toContain("list_teams");
      expect(toolNames).toContain("list_rules");
      expect(toolNames).toContain("list_queues");
      expect(toolNames).toContain("get_rule_performance");
      expect(toolNames).toContain("get_team_workload");
      expect(toolNames).toContain("get_org_settings");
    });

    it("returns ALL mutation tools", () => {
      const globalMutationTools = MUTATION_TOOLS.filter((t) =>
        t.contexts.includes("global")
      );
      for (const mt of globalMutationTools) {
        expect(toolNames).toContain(mt.name);
      }
    });

    it("has more tools than any single non-global context", () => {
      const licenseTools = getToolsForContext("license-users");
      const teamTools = getToolsForContext("teams");
      const ruleTools = getToolsForContext("routing-rules");
      expect(tools.length).toBeGreaterThan(licenseTools.length);
      expect(tools.length).toBeGreaterThan(teamTools.length);
      expect(tools.length).toBeGreaterThan(ruleTools.length);
    });
  });

  describe("tool uniqueness and structure", () => {
    it.each(ALL_CONTEXTS)("no duplicate tool names in %s context", (context) => {
      const tools = getToolsForContext(context);
      const names = tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
    });

    it.each(ALL_CONTEXTS)("every tool in %s context has required fields", (context) => {
      const tools = getToolsForContext(context);
      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(typeof tool.name).toBe("string");
        expect(tool.description).toBeTruthy();
        expect(typeof tool.description).toBe("string");
        expect(tool.input_schema).toBeDefined();
        expect(tool.input_schema.type).toBe("object");
      }
    });
  });
});

describe("CONTEXT_PROMPTS", () => {
  it("has a prompt for every context", () => {
    for (const ctx of ALL_CONTEXTS) {
      expect(CONTEXT_PROMPTS[ctx]).toBeTruthy();
      expect(typeof CONTEXT_PROMPTS[ctx]).toBe("string");
    }
  });

  it("license-users prompt mentions licensing", () => {
    expect(CONTEXT_PROMPTS["license-users"]).toContain("license");
  });

  it("teams prompt mentions round-robin", () => {
    expect(CONTEXT_PROMPTS["teams"]).toContain("round-robin");
  });

  it("routing-rules prompt mentions SEARCH triggerEvent", () => {
    expect(CONTEXT_PROMPTS["routing-rules"]).toContain("SEARCH");
  });

  it("global prompt mentions ALL capabilities", () => {
    expect(CONTEXT_PROMPTS["global"]).toContain("ALL");
  });
});
