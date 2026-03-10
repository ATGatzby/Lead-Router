import { describe, it, expect, vi, beforeEach } from "vitest";
import { builderToApiBody, apiRuleToBuilderState } from "./builder-to-rule";
import type { RouteBuilderState } from "@/components/route-builder/types";

// Mock crypto.randomUUID for deterministic IDs in tests
let uuidCounter = 0;
beforeEach(() => {
  uuidCounter = 0;
  vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `uuid-${++uuidCounter}` as `${string}-${string}-${string}-${string}-${string}`
  );
});

function makeBuilderState(
  overrides: Partial<RouteBuilderState> = {}
): RouteBuilderState {
  return {
    name: "Test Route",
    trigger: {
      objectType: "LEAD",
      triggerEvent: "INSERT",
      isDryRun: false,
    },
    matchConfig: null,
    paths: [],
    defaultOwner: null,
    ...overrides,
  };
}

describe("builderToApiBody", () => {
  it("converts basic builder state to API body", () => {
    const state = makeBuilderState({ name: "My Route" });
    const body = builderToApiBody(state);

    expect(body.name).toBe("My Route");
    expect(body.objectType).toBe("LEAD");
    expect(body.triggerEvent).toBe("INSERT");
    expect(body.isDryRun).toBe(false);
    expect(body.matchConfig).toBeNull();
    expect(body.branches).toEqual([]);
    expect(body.defaultOwnerType).toBeNull();
    expect(body.defaultOwnerUserId).toBeNull();
  });

  it("converts matchConfig correctly", () => {
    const state = makeBuilderState({
      matchConfig: {
        checkLeads: true,
        checkContacts: false,
        checkAccounts: true,
        matchEmail: true,
        matchPhone: false,
        matchDomain: true,
        onLeadMatch: "ASSIGN_CUSTOM",
        leadCustomAssignment: {
          assignmentType: "USER",
          assigneeId: "user-1",
          assigneeName: "John",
        },
        onContactMatch: "ASSIGN_TO_OWNER",
        contactCustomAssignment: null,
        onAccountMatch: "SKIP",
        accountCustomAssignment: null,
      },
    });

    const body = builderToApiBody(state);
    const mc = body.matchConfig as Record<string, unknown>;

    expect(mc.checkLeads).toBe(true);
    expect(mc.checkAccounts).toBe(true);
    expect(mc.matchDomain).toBe(true);
    expect(mc.leadAssignmentType).toBe("USER");
    expect(mc.leadAssigneeId).toBe("user-1");
    expect(mc.contactAssignmentType).toBeNull();
    expect(mc.accountAssignmentType).toBeNull();
  });

  it("converts branches with conditions", () => {
    const state = makeBuilderState({
      paths: [
        {
          id: "path-1",
          label: "Enterprise",
          conditions: [
            {
              id: "group-1",
              conjunction: "AND",
              conditions: [
                {
                  id: "c1",
                  groupId: "group-1",
                  fieldApiName: "AnnualRevenue",
                  fieldType: "NUMBER",
                  operator: "gt",
                  value: "1000000",
                },
                {
                  id: "c2",
                  groupId: "group-1",
                  fieldApiName: "Industry",
                  fieldType: "PICKLIST",
                  operator: "equals",
                  value: "Technology",
                },
              ],
            },
          ],
          action: {
            assignmentType: "USER",
            assigneeId: "user-ent",
            assigneeName: "Enterprise Rep",
          },
        },
      ],
    });

    const body = builderToApiBody(state);
    const branches = body.branches as Array<Record<string, unknown>>;

    expect(branches).toHaveLength(1);
    expect(branches[0].id).toBe("path-1");
    expect(branches[0].label).toBe("Enterprise");
    expect(branches[0].priority).toBe(0);
    expect(branches[0].assignmentType).toBe("USER");
    expect(branches[0].assigneeUserId).toBe("user-ent");
    expect(branches[0].assigneeTeamId).toBeNull();
    expect(branches[0].assigneeQueueId).toBeNull();

    const conditions = branches[0].conditions as Array<Record<string, unknown>>;
    expect(conditions).toHaveLength(2);
    expect(conditions[0].fieldName).toBe("AnnualRevenue");
    expect(conditions[0].operator).toBe("gt");
    expect(conditions[0].value).toBe("1000000");
    expect(conditions[0].groupId).toBe("group-1");
    expect(conditions[1].fieldName).toBe("Industry");
  });

  it("maps ROUND_ROBIN assignmentType to assigneeTeamId", () => {
    const state = makeBuilderState({
      paths: [
        {
          id: "p1",
          label: "RR Path",
          conditions: [],
          action: {
            assignmentType: "ROUND_ROBIN",
            assigneeId: "team-1",
            assigneeName: "Sales Team",
          },
        },
      ],
    });

    const body = builderToApiBody(state);
    const branch = (body.branches as Array<Record<string, unknown>>)[0];
    expect(branch.assigneeTeamId).toBe("team-1");
    expect(branch.assigneeUserId).toBeNull();
    expect(branch.assigneeQueueId).toBeNull();
  });

  it("maps QUEUE assignmentType to assigneeQueueId", () => {
    const state = makeBuilderState({
      paths: [
        {
          id: "p1",
          label: "Queue Path",
          conditions: [],
          action: {
            assignmentType: "QUEUE",
            assigneeId: "queue-1",
            assigneeName: "Support Queue",
          },
        },
      ],
    });

    const body = builderToApiBody(state);
    const branch = (body.branches as Array<Record<string, unknown>>)[0];
    expect(branch.assigneeQueueId).toBe("queue-1");
    expect(branch.assigneeUserId).toBeNull();
  });

  it("converts default owner correctly", () => {
    const state = makeBuilderState({
      defaultOwner: {
        assignmentType: "ROUND_ROBIN",
        assigneeId: "team-default",
        assigneeName: "Default Team",
      },
    });

    const body = builderToApiBody(state);
    expect(body.defaultOwnerType).toBe("ROUND_ROBIN");
    expect(body.defaultOwnerTeamId).toBe("team-default");
    expect(body.defaultOwnerUserId).toBeNull();
    expect(body.defaultOwnerQueueId).toBeNull();
  });
});

describe("apiRuleToBuilderState", () => {
  it("converts a minimal API rule to builder state", () => {
    const rule = {
      name: "My Rule",
      objectType: "CONTACT",
      triggerEvent: "UPDATE",
      isDryRun: true,
      branches: [],
      matchConfig: null,
      defaultOwnerType: null,
    };

    const state = apiRuleToBuilderState(rule);
    expect(state.name).toBe("My Rule");
    expect(state.trigger.objectType).toBe("CONTACT");
    expect(state.trigger.triggerEvent).toBe("UPDATE");
    expect(state.trigger.isDryRun).toBe(true);
    expect(state.matchConfig).toBeNull();
    expect(state.defaultOwner).toBeNull();
    // Should have at least one default path when branches is empty
    expect(state.paths.length).toBeGreaterThanOrEqual(1);
  });

  it("converts branches with conditions back to builder paths", () => {
    const rule = {
      name: "Rule With Branches",
      objectType: "LEAD",
      triggerEvent: "INSERT",
      isDryRun: false,
      branches: [
        {
          id: "branch-1",
          label: "Path A",
          assignmentType: "USER",
          assigneeUserId: "user-1",
          assigneeUser: { name: "Alice" },
          conditions: [
            {
              groupId: "g1",
              fieldName: "Industry",
              fieldType: "TEXT",
              operator: "equals",
              value: "Tech",
            },
            {
              groupId: "g1",
              fieldName: "Revenue",
              fieldType: "NUMBER",
              operator: "gt",
              value: "500000",
            },
          ],
        },
      ],
    };

    const state = apiRuleToBuilderState(rule);
    expect(state.paths).toHaveLength(1);
    expect(state.paths[0].label).toBe("Path A");
    expect(state.paths[0].action.assignmentType).toBe("USER");
    expect(state.paths[0].action.assigneeId).toBe("user-1");
    expect(state.paths[0].action.assigneeName).toBe("Alice");

    // Both conditions in same group
    expect(state.paths[0].conditions).toHaveLength(1); // 1 group
    expect(state.paths[0].conditions[0].conditions).toHaveLength(2); // 2 conditions in group
    expect(state.paths[0].conditions[0].conditions[0].fieldApiName).toBe(
      "Industry"
    );
    expect(state.paths[0].conditions[0].conditions[1].fieldApiName).toBe(
      "Revenue"
    );
  });

  it("converts matchConfig from API format", () => {
    const rule = {
      name: "Match Rule",
      objectType: "LEAD",
      triggerEvent: "INSERT",
      isDryRun: false,
      branches: [],
      matchConfig: {
        checkLeads: true,
        checkContacts: true,
        checkAccounts: false,
        matchEmail: true,
        matchPhone: false,
        matchDomain: true,
        onLeadMatch: "ASSIGN_CUSTOM",
        leadAssignmentType: "USER",
        leadAssigneeId: "user-lead",
        onContactMatch: "ASSIGN_TO_OWNER",
        contactAssignmentType: null,
        contactAssigneeId: null,
        onAccountMatch: "SKIP",
      },
    };

    const state = apiRuleToBuilderState(rule);
    expect(state.matchConfig).not.toBeNull();
    expect(state.matchConfig!.checkLeads).toBe(true);
    expect(state.matchConfig!.matchDomain).toBe(true);
    expect(state.matchConfig!.onLeadMatch).toBe("ASSIGN_CUSTOM");
    expect(state.matchConfig!.leadCustomAssignment).toEqual({
      assignmentType: "USER",
      assigneeId: "user-lead",
      assigneeName: "",
    });
    expect(state.matchConfig!.contactCustomAssignment).toBeNull();
    expect(state.matchConfig!.accountCustomAssignment).toBeNull();
  });

  it("converts default owner from API format", () => {
    const rule = {
      name: "Default Owner Rule",
      objectType: "LEAD",
      triggerEvent: "INSERT",
      isDryRun: false,
      branches: [],
      defaultOwnerType: "QUEUE",
      defaultOwnerQueueId: "queue-1",
      defaultOwnerQueue: { name: "Support Queue" },
    };

    const state = apiRuleToBuilderState(rule);
    expect(state.defaultOwner).not.toBeNull();
    expect(state.defaultOwner!.assignmentType).toBe("QUEUE");
    expect(state.defaultOwner!.assigneeId).toBe("queue-1");
    expect(state.defaultOwner!.assigneeName).toBe("Support Queue");
  });

  it("uses defaults for missing fields", () => {
    const rule = {};
    const state = apiRuleToBuilderState(rule);

    expect(state.name).toBe("Untitled Route");
    expect(state.trigger.objectType).toBe("LEAD");
    expect(state.trigger.triggerEvent).toBe("INSERT");
    expect(state.trigger.isDryRun).toBe(false);
  });
});

describe("round-trip conversion", () => {
  it("builderToApiBody -> apiRuleToBuilderState preserves core data", () => {
    const original = makeBuilderState({
      name: "Round Trip Route",
      trigger: { objectType: "CONTACT", triggerEvent: "BOTH", isDryRun: true },
      paths: [
        {
          id: "path-rt",
          label: "RT Path",
          conditions: [
            {
              id: "g-rt",
              conjunction: "AND",
              conditions: [
                {
                  id: "c-rt",
                  groupId: "g-rt",
                  fieldApiName: "Email",
                  fieldType: "TEXT",
                  operator: "contains",
                  value: "@acme.com",
                },
              ],
            },
          ],
          action: {
            assignmentType: "USER",
            assigneeId: "user-rt",
            assigneeName: "RT User",
          },
        },
      ],
      defaultOwner: {
        assignmentType: "USER",
        assigneeId: "user-default",
        assigneeName: "Default User",
      },
    });

    const apiBody = builderToApiBody(original);
    const restored = apiRuleToBuilderState(apiBody);

    // Core fields preserved
    expect(restored.name).toBe(original.name);
    expect(restored.trigger.objectType).toBe(original.trigger.objectType);
    expect(restored.trigger.triggerEvent).toBe(original.trigger.triggerEvent);
    expect(restored.trigger.isDryRun).toBe(original.trigger.isDryRun);

    // Branches preserved
    expect(restored.paths).toHaveLength(1);
    expect(restored.paths[0].label).toBe("RT Path");
    expect(restored.paths[0].action.assignmentType).toBe("USER");
    expect(restored.paths[0].action.assigneeId).toBe("user-rt");

    // Conditions preserved
    expect(restored.paths[0].conditions).toHaveLength(1);
    expect(restored.paths[0].conditions[0].conditions).toHaveLength(1);
    expect(restored.paths[0].conditions[0].conditions[0].fieldApiName).toBe(
      "Email"
    );
    expect(restored.paths[0].conditions[0].conditions[0].operator).toBe(
      "contains"
    );
    expect(restored.paths[0].conditions[0].conditions[0].value).toBe(
      "@acme.com"
    );

    // Default owner preserved
    expect(restored.defaultOwner).not.toBeNull();
    expect(restored.defaultOwner!.assignmentType).toBe("USER");
    expect(restored.defaultOwner!.assigneeId).toBe("user-default");
  });

  it("handles matchConfig round-trip", () => {
    const original = makeBuilderState({
      matchConfig: {
        checkLeads: true,
        checkContacts: true,
        checkAccounts: false,
        matchEmail: true,
        matchPhone: true,
        matchDomain: false,
        onLeadMatch: "SFDC_MERGE",
        leadCustomAssignment: null,
        onContactMatch: "ASSIGN_CUSTOM",
        contactCustomAssignment: {
          assignmentType: "ROUND_ROBIN",
          assigneeId: "team-1",
          assigneeName: "Sales",
        },
        onAccountMatch: "SKIP",
        accountCustomAssignment: null,
      },
    });

    const apiBody = builderToApiBody(original);
    const restored = apiRuleToBuilderState(apiBody);

    expect(restored.matchConfig).not.toBeNull();
    expect(restored.matchConfig!.checkLeads).toBe(true);
    expect(restored.matchConfig!.checkContacts).toBe(true);
    expect(restored.matchConfig!.checkAccounts).toBe(false);
    expect(restored.matchConfig!.onContactMatch).toBe("ASSIGN_CUSTOM");
    expect(restored.matchConfig!.contactCustomAssignment).toEqual({
      assignmentType: "ROUND_ROBIN",
      assigneeId: "team-1",
      assigneeName: "",
    });
    expect(restored.matchConfig!.leadCustomAssignment).toBeNull();
  });
});
