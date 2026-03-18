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
    routeType: "REALTIME",
    trigger: {
      triggerName: "",
      objectType: "LEAD",
      triggerEvent: "INSERT",
      isDryRun: false,
      triggerConditions: [],
    },
    searchTrigger: null,
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
        matchCompanyName: false,
        fuzzyMatchMode: "STRICT",
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
    expect(state.trigger).not.toBeNull();
    expect(state.trigger!.objectType).toBe("CONTACT");
    expect(state.trigger!.triggerEvent).toBe("UPDATE");
    expect(state.trigger!.isDryRun).toBe(true);
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
    // Empty rule has no trigger conditions, defaults to REALTIME with trigger
    expect(state.trigger).not.toBeNull();
    expect(state.trigger!.objectType).toBe("LEAD");
    expect(state.trigger!.triggerEvent).toBe("INSERT");
    expect(state.trigger!.isDryRun).toBe(false);
  });
});

// ── Nested split serialization ─────────────────────────────────────────────

describe("builderToApiBody — nested splits", () => {
  it("serializes V2 branch with steps including a nested split", () => {
    const state = makeBuilderState({
      paths: [
        {
          id: "path-1",
          label: "Split Path",
          conditions: [
            {
              id: "g-top",
              conjunction: "AND" as const,
              conditions: [
                { id: "c-top", groupId: "g-top", fieldApiName: "Region", fieldType: "TEXT" as const, operator: "equals", value: "US" },
              ],
            },
          ],
          action: { assignmentType: null, assigneeId: null, assigneeName: null },
          steps: [
            {
              type: "filter" as const,
              conditions: [
                {
                  id: "g-top",
                  conjunction: "AND" as const,
                  conditions: [
                    { id: "c-top", groupId: "g-top", fieldApiName: "Region", fieldType: "TEXT" as const, operator: "equals", value: "US" },
                  ],
                },
              ],
            },
            {
              type: "split" as const,
              paths: [
                {
                  id: "sub-a",
                  label: "Enterprise",
                  conditions: [
                    {
                      id: "g-sub-a",
                      conjunction: "AND" as const,
                      conditions: [
                        { id: "c-sub-a", groupId: "g-sub-a", fieldApiName: "AnnualRevenue", fieldType: "NUMBER" as const, operator: "gt", value: "1000000" },
                      ],
                    },
                  ],
                  action: { assignmentType: "USER" as const, assigneeId: "user-ent", assigneeName: "Ent Rep" },
                  steps: [
                    {
                      type: "filter" as const,
                      conditions: [
                        {
                          id: "g-sub-a",
                          conjunction: "AND" as const,
                          conditions: [
                            { id: "c-sub-a", groupId: "g-sub-a", fieldApiName: "AnnualRevenue", fieldType: "NUMBER" as const, operator: "gt", value: "1000000" },
                          ],
                        },
                      ],
                    },
                    { type: "assign" as const, assignmentType: "USER" as const, assigneeId: "user-ent", assigneeName: "Ent Rep" },
                  ],
                },
                {
                  id: "sub-b",
                  label: "SMB",
                  conditions: [],
                  action: { assignmentType: "ROUND_ROBIN" as const, assigneeId: "team-smb", assigneeName: "SMB Team" },
                  steps: [
                    { type: "filter" as const, conditions: [] },
                    { type: "assign" as const, assignmentType: "ROUND_ROBIN" as const, assigneeId: "team-smb", assigneeName: "SMB Team" },
                  ],
                },
              ],
              defaultOwner: null,
            },
          ],
        },
      ],
    });

    const body = builderToApiBody(state);
    const branches = body.branches as Array<Record<string, unknown>>;

    expect(branches).toHaveLength(1);
    expect(branches[0].steps).toBeDefined();

    const steps = branches[0].steps as Array<Record<string, unknown>>;
    const splitStep = steps.find((s) => s.type === "split") as Record<string, unknown>;
    expect(splitStep).toBeDefined();

    const subPaths = splitStep.paths as Array<Record<string, unknown>>;
    expect(subPaths).toHaveLength(2);
    expect(subPaths[0].label).toBe("Enterprise");
    expect(subPaths[1].label).toBe("SMB");
  });

  it("syncConditionsIntoSteps syncs path.conditions into steps[0] filter", () => {
    const state = makeBuilderState({
      paths: [
        {
          id: "path-sync",
          label: "Sync Test",
          conditions: [
            {
              id: "g-new",
              conjunction: "AND" as const,
              conditions: [
                { id: "c-new", groupId: "g-new", fieldApiName: "Updated_Field__c", fieldType: "TEXT" as const, operator: "equals", value: "new-value" },
              ],
            },
          ],
          action: { assignmentType: "USER" as const, assigneeId: "user-1", assigneeName: "User 1" },
          steps: [
            {
              type: "filter" as const,
              conditions: [
                {
                  id: "g-old",
                  conjunction: "AND" as const,
                  conditions: [
                    { id: "c-old", groupId: "g-old", fieldApiName: "Old_Field__c", fieldType: "TEXT" as const, operator: "equals", value: "old-value" },
                  ],
                },
              ],
            },
            { type: "assign" as const, assignmentType: "USER" as const, assigneeId: "user-old", assigneeName: "Old User" },
          ],
        },
      ],
    });

    const body = builderToApiBody(state);
    const branch = (body.branches as any[])[0];

    // The conditions in the API body should come from synced steps[0],
    // which should now have the NEW conditions from path.conditions
    const conditions = branch.conditions as Array<Record<string, unknown>>;
    expect(conditions).toHaveLength(1);
    expect(conditions[0].fieldName).toBe("Updated_Field__c");
    expect(conditions[0].value).toBe("new-value");
  });

  it("syncConditionsIntoSteps syncs path.action into assign step", () => {
    const state = makeBuilderState({
      paths: [
        {
          id: "path-action-sync",
          label: "Action Sync",
          conditions: [],
          action: { assignmentType: "ROUND_ROBIN" as const, assigneeId: "team-new", assigneeName: "New Team" },
          steps: [
            { type: "filter" as const, conditions: [] },
            { type: "assign" as const, assignmentType: "USER" as const, assigneeId: "user-old", assigneeName: "Old User" },
          ],
        },
      ],
    });

    const body = builderToApiBody(state);
    const branch = (body.branches as any[])[0];
    const steps = branch.steps as any[];
    const assignStep = steps.find((s: any) => s.type === "assign");

    // The assign step should be synced with the new action from path.action
    expect(assignStep.assignmentType).toBe("ROUND_ROBIN");
    expect(assignStep.assigneeId).toBe("team-new");
    expect(assignStep.assigneeName).toBe("New Team");
  });

  it("conditions derived from steps[0] filter, not path.conditions, when steps exist", () => {
    // When a path has steps, the API body conditions should come from
    // the filter step (after sync), not directly from path.conditions
    const state = makeBuilderState({
      paths: [
        {
          id: "path-source",
          label: "Source Test",
          // Empty path.conditions
          conditions: [],
          action: { assignmentType: null, assigneeId: null, assigneeName: null },
          steps: [
            {
              type: "filter" as const,
              conditions: [
                {
                  id: "g-steps",
                  conjunction: "AND" as const,
                  conditions: [
                    { id: "c-steps", groupId: "g-steps", fieldApiName: "From_Steps__c", fieldType: "TEXT" as const, operator: "equals", value: "step-value" },
                  ],
                },
              ],
            },
            { type: "assign" as const, assignmentType: null, assigneeId: null, assigneeName: null },
          ],
        },
      ],
    });

    const body = builderToApiBody(state);
    const branch = (body.branches as any[])[0];
    const conditions = branch.conditions as Array<Record<string, unknown>>;

    // Should use conditions from steps[0] filter since path.conditions is empty
    expect(conditions).toHaveLength(1);
    expect(conditions[0].fieldName).toBe("From_Steps__c");
  });
});

describe("round-trip conversion", () => {
  it("builderToApiBody -> apiRuleToBuilderState preserves core data", () => {
    const original = makeBuilderState({
      name: "Round Trip Route",
      trigger: { triggerName: "", objectType: "CONTACT", triggerEvent: "BOTH", isDryRun: true, triggerConditions: [] },
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
    expect(restored.trigger).not.toBeNull();
    expect(restored.trigger!.objectType).toBe(original.trigger!.objectType);
    expect(restored.trigger!.triggerEvent).toBe(original.trigger!.triggerEvent);
    expect(restored.trigger!.isDryRun).toBe(original.trigger!.isDryRun);

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

  it("preserves nested splits through round-trip", () => {
    const original = makeBuilderState({
      name: "Nested Split Round Trip",
      paths: [
        {
          id: "path-rt",
          label: "Split Path",
          conditions: [
            {
              id: "g-top",
              conjunction: "AND" as const,
              conditions: [
                { id: "c-top", groupId: "g-top", fieldApiName: "Region", fieldType: "TEXT" as const, operator: "equals", value: "US" },
              ],
            },
          ],
          action: { assignmentType: null, assigneeId: null, assigneeName: null },
          steps: [
            {
              type: "filter" as const,
              conditions: [
                {
                  id: "g-top",
                  conjunction: "AND" as const,
                  conditions: [
                    { id: "c-top", groupId: "g-top", fieldApiName: "Region", fieldType: "TEXT" as const, operator: "equals", value: "US" },
                  ],
                },
              ],
            },
            {
              type: "split" as const,
              paths: [
                {
                  id: "sub-a",
                  label: "Enterprise",
                  conditions: [],
                  action: { assignmentType: "USER" as const, assigneeId: "user-ent", assigneeName: "Ent" },
                  steps: [
                    { type: "filter" as const, conditions: [] },
                    { type: "assign" as const, assignmentType: "USER" as const, assigneeId: "user-ent", assigneeName: "Ent" },
                  ],
                },
              ],
              defaultOwner: null,
            },
          ],
        },
      ],
    });

    const apiBody = builderToApiBody(original);
    const restored = apiRuleToBuilderState(apiBody);

    // The restored state should have the steps preserved (including nested split)
    expect(restored.paths).toHaveLength(1);
    expect(restored.paths[0].steps).toBeDefined();

    const steps = restored.paths[0].steps!;
    const splitStep = steps.find((s) => s.type === "split");
    expect(splitStep).toBeDefined();

    if (splitStep && splitStep.type === "split") {
      expect(splitStep.paths).toHaveLength(1);
      expect(splitStep.paths[0].label).toBe("Enterprise");
    }
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
        matchCompanyName: true,
        fuzzyMatchMode: "FUZZY",
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
    expect(restored.matchConfig!.matchCompanyName).toBe(true);
    expect(restored.matchConfig!.fuzzyMatchMode).toBe("FUZZY");
    expect(restored.matchConfig!.onContactMatch).toBe("ASSIGN_CUSTOM");
    expect(restored.matchConfig!.contactCustomAssignment).toEqual({
      assignmentType: "ROUND_ROBIN",
      assigneeId: "team-1",
      assigneeName: "",
    });
    expect(restored.matchConfig!.leadCustomAssignment).toBeNull();
  });
});
