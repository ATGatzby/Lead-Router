import { describe, it, expect } from "vitest";
import { MUTATION_TOOLS, type MutationToolDef } from "../mutation-tools";

describe("MUTATION_TOOLS", () => {
  it("defines exactly 10 mutation tools", () => {
    expect(MUTATION_TOOLS).toHaveLength(10);
  });

  const expectedNames = [
    "license_users",
    "delicense_users",
    "create_team",
    "update_team",
    "delete_team",
    "manage_team_members",
    "update_team_weights",
    "create_rule",
    "toggle_rule",
    "delete_rule",
  ];

  it("contains all expected tool names", () => {
    const names = MUTATION_TOOLS.map((t) => t.name);
    for (const expected of expectedNames) {
      expect(names).toContain(expected);
    }
  });

  it("all tool names are unique", () => {
    const names = MUTATION_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  describe("required fields on each tool", () => {
    it.each(MUTATION_TOOLS.map((t) => [t.name, t]))(
      "%s has name, description, input_schema, destructive, and contexts",
      (_name, tool) => {
        const t = tool as MutationToolDef;
        expect(typeof t.name).toBe("string");
        expect(t.name.length).toBeGreaterThan(0);
        expect(typeof t.description).toBe("string");
        expect(t.description.length).toBeGreaterThan(0);
        expect(t.input_schema).toBeDefined();
        expect(t.input_schema.type).toBe("object");
        expect(typeof t.destructive).toBe("boolean");
        expect(Array.isArray(t.contexts)).toBe(true);
        expect(t.contexts.length).toBeGreaterThan(0);
      }
    );
  });

  describe("destructive flag", () => {
    const destructiveTools = ["delicense_users", "delete_team", "delete_rule"];
    const nonDestructiveTools = [
      "license_users",
      "create_team",
      "update_team",
      "manage_team_members",
      "update_team_weights",
      "create_rule",
      "toggle_rule",
    ];

    it.each(destructiveTools)("%s is marked as destructive", (name) => {
      const tool = MUTATION_TOOLS.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.destructive).toBe(true);
    });

    it.each(nonDestructiveTools)("%s is marked as non-destructive", (name) => {
      const tool = MUTATION_TOOLS.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.destructive).toBe(false);
    });
  });

  describe("confirm property on input_schema", () => {
    it.each(MUTATION_TOOLS.map((t) => [t.name, t]))(
      "%s has a confirm boolean property",
      (_name, tool) => {
        const t = tool as MutationToolDef;
        const confirmProp = t.input_schema.properties.confirm as any;
        expect(confirmProp).toBeDefined();
        expect(confirmProp.type).toBe("boolean");
      }
    );
  });

  describe("context assignments", () => {
    it("license tools belong to license-users and global", () => {
      const licenseTools = MUTATION_TOOLS.filter(
        (t) => t.name === "license_users" || t.name === "delicense_users"
      );
      for (const tool of licenseTools) {
        expect(tool.contexts).toContain("license-users");
        expect(tool.contexts).toContain("global");
        expect(tool.contexts).not.toContain("teams");
        expect(tool.contexts).not.toContain("routing-rules");
      }
    });

    it("team tools belong to teams and global", () => {
      const teamTools = MUTATION_TOOLS.filter((t) =>
        ["create_team", "update_team", "delete_team", "manage_team_members", "update_team_weights"].includes(t.name)
      );
      for (const tool of teamTools) {
        expect(tool.contexts).toContain("teams");
        expect(tool.contexts).toContain("global");
        expect(tool.contexts).not.toContain("license-users");
        expect(tool.contexts).not.toContain("routing-rules");
      }
    });

    it("rule tools belong to routing-rules and global", () => {
      const ruleTools = MUTATION_TOOLS.filter((t) =>
        ["create_rule", "toggle_rule", "delete_rule"].includes(t.name)
      );
      for (const tool of ruleTools) {
        expect(tool.contexts).toContain("routing-rules");
        expect(tool.contexts).toContain("global");
        expect(tool.contexts).not.toContain("license-users");
        expect(tool.contexts).not.toContain("teams");
      }
    });

    it("every mutation tool includes global in its contexts", () => {
      for (const tool of MUTATION_TOOLS) {
        expect(tool.contexts).toContain("global");
      }
    });
  });

  describe("create_rule schema", () => {
    it("includes SEARCH in triggerEvent enum", () => {
      const createRule = MUTATION_TOOLS.find((t) => t.name === "create_rule")!;
      const triggerProp = createRule.input_schema.properties.triggerEvent as any;
      expect(triggerProp).toBeDefined();
      expect(triggerProp.enum).toContain("SEARCH");
      expect(triggerProp.enum).toContain("INSERT");
      expect(triggerProp.enum).toContain("UPDATE");
      expect(triggerProp.enum).toContain("BOTH");
    });

    it("has name, objectType, triggerEvent as required fields", () => {
      const createRule = MUTATION_TOOLS.find((t) => t.name === "create_rule")!;
      expect(createRule.input_schema.required).toEqual(
        expect.arrayContaining(["name", "objectType", "triggerEvent"])
      );
    });

    it("has routeType and scheduleFrequency properties for scheduled rules", () => {
      const createRule = MUTATION_TOOLS.find((t) => t.name === "create_rule")!;
      expect(createRule.input_schema.properties.routeType).toBeDefined();
      expect(createRule.input_schema.properties.scheduleFrequency).toBeDefined();
      expect(createRule.input_schema.properties.scheduleTime).toBeDefined();
      expect(createRule.input_schema.properties.scheduleTimezone).toBeDefined();
    });
  });
});
