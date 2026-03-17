import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  user: {
    findMany: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
  },
  organization: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  roundRobinTeam: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  routingRule: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  routingBranch: {
    findMany: vi.fn(),
  },
  routingLog: {
    count: vi.fn(),
  },
  teamMember: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
    update: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  aiAgentLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("@lead-routing/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/invalidate-rules-cache", () => ({
  invalidateRulesCache: vi.fn(),
}));

vi.mock("@/lib/sync-routing-flags", () => ({
  syncRoutingFlags: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/license", () => ({
  getTierLimits: vi.fn().mockReturnValue({
    maxSeats: Infinity,
    maxRules: Infinity,
    weightedDistribution: true,
    allowedTriggers: ["LEAD", "CONTACT", "ACCOUNT"],
  }),
}));

import {
  licenseUsers,
  delicenseUsers,
  createTeam,
  deleteTeam,
  toggleRule,
  createRule,
} from "../mutations";

const ORG_ID = "org_test_123";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.aiAgentLog.create.mockResolvedValue({});
});

// ─── licenseUsers ────────────────────────────────────────────────────────────

describe("licenseUsers", () => {
  it("returns error for missing userIds", async () => {
    const result = await licenseUsers(ORG_ID, {});
    expect(result).toEqual({ error: "userIds must be a non-empty array" });
  });

  it("returns error for empty userIds array", async () => {
    const result = await licenseUsers(ORG_ID, { userIds: [] });
    expect(result).toEqual({ error: "userIds must be a non-empty array" });
  });

  it("returns error when users not found", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", name: "Alice", email: "alice@test.com", isLicensed: false, isActive: true },
    ]);

    const result = await licenseUsers(ORG_ID, { userIds: ["u1", "u2"] });
    expect(result).toEqual({ error: "Users not found: u2" });
  });

  it("returns preview object when confirm=false", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", name: "Alice", email: "alice@test.com", isLicensed: false, isActive: true },
      { id: "u2", name: "Bob", email: "bob@test.com", isLicensed: false, isActive: true },
    ]);
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({ seatsPurchased: 50 });
    mockPrisma.user.count.mockResolvedValue(10);

    const result = (await licenseUsers(ORG_ID, {
      userIds: ["u1", "u2"],
      confirm: false,
    })) as any;

    expect(result.action).toBe("LICENSE");
    expect(result.count).toBe(2);
    expect(result.willLicense).toHaveLength(2);
    expect(result.seatsAfter).toEqual({ used: 12, purchased: 50 });
    // Verify the DB was NOT mutated
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("executes licensing when confirm=true", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", name: "Alice", email: "alice@test.com", isLicensed: false, isActive: true },
    ]);
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({ seatsPurchased: 50 });
    mockPrisma.user.count.mockResolvedValue(10);
    mockPrisma.$transaction.mockResolvedValue([]);

    const result = (await licenseUsers(ORG_ID, {
      userIds: ["u1"],
      confirm: true,
    })) as any;

    expect(result.action).toBe("LICENSE");
    expect(result.affected).toBe(1);
    expect(result.licensedUsers).toEqual([{ id: "u1", name: "Alice" }]);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns seat_cap_exceeded error when not enough seats", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", name: "Alice", email: "alice@test.com", isLicensed: false, isActive: true },
      { id: "u2", name: "Bob", email: "bob@test.com", isLicensed: false, isActive: true },
    ]);
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({ seatsPurchased: 11 });
    mockPrisma.user.count.mockResolvedValue(10); // 10 used, 1 available but requesting 2

    const result = (await licenseUsers(ORG_ID, {
      userIds: ["u1", "u2"],
      confirm: false,
    })) as any;

    expect(result.error).toBe("seat_cap_exceeded");
    expect(result.available).toBe(1);
    expect(result.requested).toBe(2);
  });
});

// ─── delicenseUsers ──────────────────────────────────────────────────────────

describe("delicenseUsers", () => {
  it("returns error for missing userIds", async () => {
    const result = await delicenseUsers(ORG_ID, {});
    expect(result).toEqual({ error: "userIds must be a non-empty array" });
  });

  it("returns preview with team impact when confirm=false", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", name: "Alice", email: "alice@test.com", isLicensed: true },
    ]);
    mockPrisma.teamMember.findMany.mockResolvedValue([
      { userId: "u1", team: { name: "Sales Team" } },
    ]);

    const result = (await delicenseUsers(ORG_ID, {
      userIds: ["u1"],
      confirm: false,
    })) as any;

    expect(result.action).toBe("DE_LICENSE");
    expect(result.count).toBe(1);
    expect(result.teamMembershipsToBePaused).toHaveLength(1);
    expect(result.teamMembershipsToBePaused[0].teamName).toBe("Sales Team");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns already-unlicensed message when no users to delicense", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", name: "Alice", email: "alice@test.com", isLicensed: false },
    ]);

    const result = (await delicenseUsers(ORG_ID, {
      userIds: ["u1"],
      confirm: false,
    })) as any;

    expect(result.affected).toBe(0);
    expect(result.message).toContain("already unlicensed");
  });
});

// ─── createTeam ──────────────────────────────────────────────────────────────

describe("createTeam", () => {
  it("returns error when name is missing", async () => {
    const result = await createTeam(ORG_ID, {});
    expect(result).toEqual({ error: "name is required" });
  });

  it("returns error for invalid distributionType", async () => {
    const result = await createTeam(ORG_ID, { name: "Test", distributionType: "invalid" });
    expect(result).toEqual({ error: "distributionType must be 'round-robin' or 'weighted'" });
  });

  it("returns preview when confirm=false", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(null); // no duplicate

    const result = (await createTeam(ORG_ID, {
      name: "New Team",
      distributionType: "round-robin",
      confirm: false,
    })) as any;

    expect(result.action).toBe("CREATE_TEAM");
    expect(result.name).toBe("New Team");
    expect(result.distributionType).toBe("round-robin");
    // Not actually created
    expect(mockPrisma.roundRobinTeam.create).not.toHaveBeenCalled();
  });

  it("creates team when confirm=true", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(null);
    mockPrisma.roundRobinTeam.create.mockResolvedValue({
      id: "team_new",
      name: "New Team",
      distributionType: "round-robin",
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = (await createTeam(ORG_ID, {
      name: "New Team",
      confirm: true,
    })) as any;

    expect(result.action).toBe("CREATE_TEAM");
    expect(result.team.id).toBe("team_new");
    expect(mockPrisma.roundRobinTeam.create).toHaveBeenCalledTimes(1);
  });

  it("returns error when team name already exists", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue({ id: "existing_id", name: "Sales" });

    const result = (await createTeam(ORG_ID, { name: "Sales", confirm: false })) as any;
    expect(result.error).toContain("already exists");
  });
});

// ─── deleteTeam ──────────────────────────────────────────────────────────────

describe("deleteTeam", () => {
  it("returns error when teamId is missing", async () => {
    const result = await deleteTeam(ORG_ID, {});
    expect(result).toEqual({ error: "teamId is required" });
  });

  it("returns error when team not found", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(null);

    const result = await deleteTeam(ORG_ID, { teamId: "nonexistent" });
    expect(result).toEqual({ error: "Team not found" });
  });

  it("returns preview with member info when confirm=false", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue({
      id: "t1",
      name: "Sales",
      members: [
        { id: "m1", user: { name: "Alice" } },
        { id: "m2", user: { name: "Bob" } },
      ],
    });
    mockPrisma.routingRule.findMany.mockResolvedValue([]); // no blocking rules
    mockPrisma.routingBranch.findMany.mockResolvedValue([]); // no blocking branches

    const result = (await deleteTeam(ORG_ID, {
      teamId: "t1",
      confirm: false,
    })) as any;

    expect(result.action).toBe("DELETE_TEAM");
    expect(result.teamName).toBe("Sales");
    expect(result.memberCount).toBe(2);
    expect(result.members).toEqual(["Alice", "Bob"]);
    expect(result.warning).toContain("2 member(s)");
    expect(mockPrisma.roundRobinTeam.delete).not.toHaveBeenCalled();
  });

  it("blocks deletion when active rules reference the team", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue({
      id: "t1",
      name: "Sales",
      members: [],
    });
    mockPrisma.routingRule.findMany.mockResolvedValue([
      { id: "r1", name: "Enterprise Route" },
    ]);

    const result = (await deleteTeam(ORG_ID, {
      teamId: "t1",
      confirm: true,
    })) as any;

    expect(result.error).toContain("referenced by active routing rules");
    expect(result.blockingRules).toHaveLength(1);
  });
});

// ─── toggleRule ──────────────────────────────────────────────────────────────

describe("toggleRule", () => {
  it("returns error when ruleId is missing", async () => {
    const result = await toggleRule(ORG_ID, {});
    expect(result).toEqual({ error: "ruleId is required" });
  });

  it("returns error when rule not found", async () => {
    mockPrisma.routingRule.findFirst.mockResolvedValue(null);

    const result = await toggleRule(ORG_ID, { ruleId: "nonexistent" });
    expect(result).toEqual({ error: "Rule not found" });
  });

  it("flips ACTIVE to INACTIVE in preview", async () => {
    mockPrisma.routingRule.findFirst.mockResolvedValue({
      id: "r1",
      name: "Enterprise",
      status: "ACTIVE",
      objectType: "LEAD",
    });

    const result = (await toggleRule(ORG_ID, {
      ruleId: "r1",
      confirm: false,
    })) as any;

    expect(result.action).toBe("TOGGLE_RULE");
    expect(result.currentStatus).toBe("ACTIVE");
    expect(result.newStatus).toBe("INACTIVE");
  });

  it("flips INACTIVE to ACTIVE in preview", async () => {
    mockPrisma.routingRule.findFirst.mockResolvedValue({
      id: "r1",
      name: "Enterprise",
      status: "INACTIVE",
      objectType: "LEAD",
    });

    const result = (await toggleRule(ORG_ID, {
      ruleId: "r1",
      confirm: false,
    })) as any;

    expect(result.action).toBe("TOGGLE_RULE");
    expect(result.currentStatus).toBe("INACTIVE");
    expect(result.newStatus).toBe("ACTIVE");
  });

  it("executes toggle when confirm=true", async () => {
    mockPrisma.routingRule.findFirst.mockResolvedValue({
      id: "r1",
      name: "Enterprise",
      status: "ACTIVE",
      objectType: "LEAD",
    });
    mockPrisma.routingRule.update.mockResolvedValue({
      id: "r1",
      name: "Enterprise",
      status: "INACTIVE",
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = (await toggleRule(ORG_ID, {
      ruleId: "r1",
      confirm: true,
    })) as any;

    expect(result.action).toBe("TOGGLE_RULE");
    expect(result.previousStatus).toBe("ACTIVE");
    expect(result.newStatus).toBe("INACTIVE");
    expect(mockPrisma.routingRule.update).toHaveBeenCalledTimes(1);
  });
});

// ─── createRule ──────────────────────────────────────────────────────────────

describe("createRule", () => {
  it("returns error when name is missing", async () => {
    const result = await createRule(ORG_ID, { objectType: "LEAD", triggerEvent: "INSERT" });
    expect(result).toEqual({ error: "name is required" });
  });

  it("returns error for invalid objectType", async () => {
    const result = await createRule(ORG_ID, {
      name: "Test",
      objectType: "INVALID",
      triggerEvent: "INSERT",
    });
    expect(result).toEqual({ error: "objectType must be LEAD, CONTACT, or ACCOUNT" });
  });

  it("returns error for invalid triggerEvent", async () => {
    const result = await createRule(ORG_ID, {
      name: "Test",
      objectType: "LEAD",
      triggerEvent: "INVALID",
    });
    expect(result).toEqual({ error: "triggerEvent must be INSERT, UPDATE, BOTH, or SEARCH" });
  });

  it("accepts SEARCH as triggerEvent", async () => {
    mockPrisma.routingRule.count.mockResolvedValue(0);
    mockPrisma.routingRule.findFirst.mockResolvedValue(null); // max priority

    const result = (await createRule(ORG_ID, {
      name: "Scheduled Scan",
      objectType: "LEAD",
      triggerEvent: "SEARCH",
      branches: [
        {
          label: "Default",
          priority: 1,
          assignmentType: "QUEUE",
          assigneeQueueId: "q1",
          conditions: [
            { groupId: "g1", fieldName: "Status", operator: "equals", value: "Open" },
          ],
        },
      ],
      confirm: false,
    })) as any;

    expect(result.action).toBe("CREATE_RULE");
    expect(result.triggerEvent).toBe("SEARCH");
  });

  it("returns preview when confirm=false", async () => {
    mockPrisma.routingRule.count.mockResolvedValue(0);
    mockPrisma.routingRule.findFirst.mockResolvedValue(null);

    const result = (await createRule(ORG_ID, {
      name: "My Rule",
      objectType: "LEAD",
      triggerEvent: "INSERT",
      assignmentType: "ROUND_ROBIN",
      confirm: false,
    })) as any;

    expect(result.action).toBe("CREATE_RULE");
    expect(result.name).toBe("My Rule");
    expect(result.objectType).toBe("LEAD");
    expect(result.triggerEvent).toBe("INSERT");
    expect(result.priority).toBe(1);
    expect(mockPrisma.routingRule.create).not.toHaveBeenCalled();
  });

  it("creates rule when confirm=true", async () => {
    mockPrisma.routingRule.count.mockResolvedValue(0);
    mockPrisma.routingRule.findFirst.mockResolvedValue(null);
    mockPrisma.routingRule.create.mockResolvedValue({
      id: "rule_new",
      name: "My Rule",
      objectType: "LEAD",
      triggerEvent: "INSERT",
      priority: 1,
      status: "ACTIVE",
      assignmentType: "ROUND_ROBIN",
      isDryRun: false,
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    const result = (await createRule(ORG_ID, {
      name: "My Rule",
      objectType: "LEAD",
      triggerEvent: "INSERT",
      assignmentType: "ROUND_ROBIN",
      assigneeTeamId: "t1",
      confirm: true,
    })) as any;

    expect(result.action).toBe("CREATE_RULE");
    expect(result.rule.id).toBe("rule_new");
    expect(mockPrisma.routingRule.create).toHaveBeenCalledTimes(1);
  });

  it("returns error when assignmentType missing for simple rules", async () => {
    mockPrisma.routingRule.count.mockResolvedValue(0);
    mockPrisma.routingRule.findFirst.mockResolvedValue(null);

    const result = (await createRule(ORG_ID, {
      name: "Test",
      objectType: "LEAD",
      triggerEvent: "INSERT",
      // no assignmentType and no branches
      confirm: false,
    })) as any;

    expect(result.error).toContain("assignmentType");
  });

  it("does not require assignmentType when branches are provided", async () => {
    mockPrisma.routingRule.count.mockResolvedValue(0);
    mockPrisma.routingRule.findFirst.mockResolvedValue(null);

    const result = (await createRule(ORG_ID, {
      name: "Branched Rule",
      objectType: "LEAD",
      triggerEvent: "INSERT",
      branches: [
        {
          label: "Enterprise",
          priority: 1,
          assignmentType: "ROUND_ROBIN",
          assigneeTeamId: "t1",
          conditions: [
            { groupId: "g1", fieldName: "AnnualRevenue", operator: "gt", value: "1000000" },
          ],
        },
      ],
      confirm: false,
    })) as any;

    expect(result.action).toBe("CREATE_RULE");
    expect(result.branchCount).toBe(1);
  });
});
