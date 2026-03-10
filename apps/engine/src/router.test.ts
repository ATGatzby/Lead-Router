import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  routingLog: {
    create: vi.fn().mockResolvedValue({ id: "log-1" }),
    update: vi.fn().mockResolvedValue({}),
  },
  user: {
    findUnique: vi.fn().mockResolvedValue({ name: "Alice" }),
    update: vi.fn().mockResolvedValue({}),
  },
  teamMember: {
    findMany: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  },
  sfdcQueue: {
    findUnique: vi.fn().mockResolvedValue({ name: "Support Queue" }),
  },
  roundRobinTeam: {
    findUnique: vi.fn().mockResolvedValue({ id: "team-1", name: "Test Team" }),
  },
}));

const mockGetActiveRules = vi.hoisted(() => vi.fn().mockReturnValue([]));
const mockEvaluateRule = vi.hoisted(() => vi.fn().mockReturnValue(false));
const mockGetNextMember = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const mockGetOrgConnection = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockGetSfdcUserId = vi.hoisted(() => vi.fn().mockResolvedValue("005SFDC_USER"));
const mockGetSfdcQueueId = vi.hoisted(() => vi.fn().mockResolvedValue("00GSFDC_QUEUE"));
const mockEnqueueRetry = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockFireWebhook = vi.hoisted(() => vi.fn());
const mockUpdateOwner = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockMergeLead = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockUpdateAggregates = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockCreateConversionTracking = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

vi.mock("./cache.js", () => ({ getActiveRules: mockGetActiveRules }));
vi.mock("./evaluator.js", () => ({ evaluateRule: mockEvaluateRule }));
vi.mock("./round-robin.js", () => ({ getNextMember: mockGetNextMember }));
const mockEvictOrgConnection = vi.hoisted(() => vi.fn());

vi.mock("./sfdc.js", () => ({
  getOrgConnection: mockGetOrgConnection,
  getSfdcUserId: mockGetSfdcUserId,
  getSfdcQueueId: mockGetSfdcQueueId,
  evictOrgConnection: mockEvictOrgConnection,
}));
vi.mock("./queue.js", () => ({ enqueueRetry: mockEnqueueRetry }));
vi.mock("./webhook.js", () => ({ fireWebhook: mockFireWebhook }));
vi.mock("@lead-routing/sfdc", () => ({
  updateOwner: mockUpdateOwner,
  mergeLead: mockMergeLead,
}));
vi.mock("./aggregate.js", () => ({
  updateAggregates: mockUpdateAggregates,
  createConversionTracking: mockCreateConversionTracking,
}));

// ─── Import under test (after mocks) ────────────────────────────────────────

import { routeRecord, type RoutingPayload } from "./router.js";
import type { CachedRule, CachedBranch, CachedMatchConfig } from "./cache.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<RoutingPayload> = {}): RoutingPayload {
  return {
    orgId: "org-1",
    objectType: "LEAD",
    eventType: "INSERT",
    recordId: "00Q000000000001",
    timestamp: new Date().toISOString(),
    fields: { Email: "test@example.com", Company: "Acme" },
    ...overrides,
  };
}

function makeLegacyRule(overrides: Partial<CachedRule> = {}): CachedRule {
  return {
    id: "rule-1",
    orgId: "org-1",
    objectType: "LEAD",
    triggerEvent: "BOTH",
    name: "Test Rule",
    priority: 1,
    isDryRun: false,
    assignmentType: "USER",
    assigneeUserId: "user-1",
    assigneeTeamId: null,
    assigneeQueueId: null,
    conditions: [
      { groupId: "g1", fieldName: "Company", operator: "equals", value: "Acme" },
    ],
    branches: [],
    matchConfig: null,
    defaultOwnerType: null,
    defaultOwnerUserId: null,
    defaultOwnerTeamId: null,
    defaultOwnerQueueId: null,
    ...overrides,
  };
}

function makeBranch(overrides: Partial<CachedBranch> = {}): CachedBranch {
  return {
    id: "branch-1",
    label: "Enterprise Path",
    priority: 1,
    assignmentType: "USER",
    assigneeUserId: "user-1",
    assigneeTeamId: null,
    assigneeQueueId: null,
    conditions: [
      { groupId: "g1", fieldName: "Company", operator: "equals", value: "Acme" },
    ],
    ...overrides,
  };
}

function makeMatchConfig(overrides: Partial<CachedMatchConfig> = {}): CachedMatchConfig {
  return {
    checkLeads: true,
    checkContacts: true,
    checkAccounts: false,
    matchEmail: true,
    matchPhone: false,
    matchDomain: false,
    onLeadMatch: "ASSIGN_TO_OWNER",
    leadAssignmentType: null,
    leadAssigneeUserId: null,
    leadAssigneeTeamId: null,
    leadAssigneeQueueId: null,
    onContactMatch: "ASSIGN_TO_OWNER",
    contactAssignmentType: null,
    contactAssigneeUserId: null,
    contactAssigneeTeamId: null,
    contactAssigneeQueueId: null,
    onAccountMatch: "ASSIGN_TO_OWNER",
    accountAssignmentType: null,
    accountAssigneeUserId: null,
    accountAssigneeTeamId: null,
    accountAssigneeQueueId: null,
    ...overrides,
  };
}

function makeNewStyleRule(overrides: Partial<CachedRule> = {}): CachedRule {
  return {
    ...makeLegacyRule({
      assignmentType: null,
      assigneeUserId: null,
      conditions: [],
    }),
    branches: [makeBranch()],
    matchConfig: null,
    defaultOwnerType: null,
    defaultOwnerUserId: null,
    defaultOwnerTeamId: null,
    defaultOwnerQueueId: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Reset default return values
  mockPrisma.routingLog.create.mockResolvedValue({ id: "log-1" });
  mockPrisma.routingLog.update.mockResolvedValue({});
  mockPrisma.user.findUnique.mockResolvedValue({ name: "Alice" });
  mockPrisma.user.update.mockResolvedValue({});
  mockPrisma.teamMember.findMany.mockResolvedValue([]);
  mockPrisma.teamMember.update.mockResolvedValue({});
  mockPrisma.sfdcQueue.findUnique.mockResolvedValue({ name: "Support Queue" });
  mockGetActiveRules.mockReturnValue([]);
  mockEvaluateRule.mockReturnValue(false);
  mockGetNextMember.mockResolvedValue(null);
  mockGetOrgConnection.mockResolvedValue({});
  mockGetSfdcUserId.mockResolvedValue("005SFDC_USER");
  mockGetSfdcQueueId.mockResolvedValue("00GSFDC_QUEUE");
  mockEnqueueRetry.mockResolvedValue(undefined);
  mockUpdateOwner.mockResolvedValue(undefined);
  mockMergeLead.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. No rules match → UNMATCHED
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — no matching rules", () => {
  it("returns 'unmatched' when no rules exist for the org/objectType", async () => {
    mockGetActiveRules.mockReturnValue([]);
    const result = await routeRecord(makePayload());
    expect(result).toBe("unmatched");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "UNMATCHED", orgId: "org-1" }),
      })
    );
  });

  it("returns 'unmatched' when rules exist but none match conditions", async () => {
    mockGetActiveRules.mockReturnValue([makeLegacyRule()]);
    mockEvaluateRule.mockReturnValue(false);
    const result = await routeRecord(makePayload());
    expect(result).toBe("unmatched");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Event type filtering (triggerEvent)
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — triggerEvent filtering", () => {
  it("includes rules with triggerEvent=BOTH for INSERT events", async () => {
    const rule = makeLegacyRule({ triggerEvent: "BOTH" });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);
    await routeRecord(makePayload({ eventType: "INSERT" }));
    expect(mockEvaluateRule).toHaveBeenCalled();
  });

  it("includes rules with triggerEvent=INSERT for INSERT events", async () => {
    const rule = makeLegacyRule({ triggerEvent: "INSERT" });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);
    await routeRecord(makePayload({ eventType: "INSERT" }));
    expect(mockEvaluateRule).toHaveBeenCalled();
  });

  it("skips rules with triggerEvent=INSERT for UPDATE events", async () => {
    const rule = makeLegacyRule({ triggerEvent: "INSERT" });
    mockGetActiveRules.mockReturnValue([rule]);
    const result = await routeRecord(makePayload({ eventType: "UPDATE" }));
    expect(result).toBe("unmatched");
    expect(mockEvaluateRule).not.toHaveBeenCalled();
  });

  it("skips rules with triggerEvent=UPDATE for INSERT events", async () => {
    const rule = makeLegacyRule({ triggerEvent: "UPDATE" });
    mockGetActiveRules.mockReturnValue([rule]);
    const result = await routeRecord(makePayload({ eventType: "INSERT" }));
    expect(result).toBe("unmatched");
    expect(mockEvaluateRule).not.toHaveBeenCalled();
  });

  it("includes rules with triggerEvent=UPDATE for UPDATE events", async () => {
    const rule = makeLegacyRule({ triggerEvent: "UPDATE" });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);
    await routeRecord(makePayload({ eventType: "UPDATE" }));
    expect(mockEvaluateRule).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Legacy routing — USER assignment
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — legacy USER assignment", () => {
  it("routes to a user and returns 'routed'", async () => {
    const rule = makeLegacyRule();
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockGetSfdcUserId).toHaveBeenCalledWith("user-1");
    expect(mockUpdateOwner).toHaveBeenCalledWith({}, "Lead", "00Q000000000001", "005SFDC_USER");
    expect(mockPrisma.routingLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SUCCESS" } })
    );
    expect(mockFireWebhook).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        event: "LEAD_ROUTED",
        recordId: "00Q000000000001",
        assigneeName: "Alice",
      })
    );
  });

  it("uses toSfdcObjectName correctly for CONTACT", async () => {
    const rule = makeLegacyRule({ objectType: "CONTACT" });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    await routeRecord(makePayload({ objectType: "CONTACT" }));

    expect(mockUpdateOwner).toHaveBeenCalledWith(
      expect.anything(), "Contact", expect.any(String), expect.any(String)
    );
  });

  it("uses toSfdcObjectName correctly for ACCOUNT", async () => {
    const rule = makeLegacyRule({ objectType: "ACCOUNT" });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    await routeRecord(makePayload({ objectType: "ACCOUNT" }));

    expect(mockUpdateOwner).toHaveBeenCalledWith(
      expect.anything(), "Account", expect.any(String), expect.any(String)
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Legacy routing — ROUND_ROBIN assignment
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — legacy ROUND_ROBIN assignment", () => {
  it("routes via round-robin when active members exist", async () => {
    const rule = makeLegacyRule({
      assignmentType: "ROUND_ROBIN",
      assigneeUserId: null,
      assigneeTeamId: "team-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const members = [
      {
        id: "tm-1", userId: "user-1", status: "ACTIVE", teamId: "team-1",
        assignmentCount: 0, createdAt: new Date(),
        user: { id: "user-1", sfdcUserId: "005RR_USER", name: "Bob", email: "bob@test.com" },
      },
    ];
    mockPrisma.teamMember.findMany.mockResolvedValue(members);
    mockGetNextMember.mockResolvedValue({
      id: "tm-1", userId: "user-1", name: "Bob", email: "bob@test.com", assignmentCount: 0,
    });

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockGetNextMember).toHaveBeenCalledWith("org-1", "team-1", expect.any(Array));
    expect(mockPrisma.teamMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tm-1" },
        data: { assignmentCount: { increment: 1 } },
      })
    );
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { lastRoutedAt: expect.any(Date) },
      })
    );
    expect(mockUpdateOwner).toHaveBeenCalledWith({}, "Lead", "00Q000000000001", "005RR_USER");
  });

  it("returns 'unmatched' when no active team members exist", async () => {
    const rule = makeLegacyRule({
      assignmentType: "ROUND_ROBIN",
      assigneeUserId: null,
      assigneeTeamId: "team-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);
    mockPrisma.teamMember.findMany.mockResolvedValue([]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("unmatched");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "No eligible assignee found",
        }),
      })
    );
  });

  it("returns 'unmatched' when getNextMember returns null", async () => {
    const rule = makeLegacyRule({
      assignmentType: "ROUND_ROBIN",
      assigneeUserId: null,
      assigneeTeamId: "team-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    mockPrisma.teamMember.findMany.mockResolvedValue([
      {
        id: "tm-1", userId: "user-1", status: "ACTIVE", teamId: "team-1",
        assignmentCount: 0, createdAt: new Date(),
        user: { id: "user-1", sfdcUserId: "005RR_USER", name: "Bob", email: "bob@test.com" },
      },
    ]);
    mockGetNextMember.mockResolvedValue(null);

    const result = await routeRecord(makePayload());
    expect(result).toBe("unmatched");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Legacy routing — QUEUE assignment
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — legacy QUEUE assignment", () => {
  it("routes to a queue and returns 'routed'", async () => {
    const rule = makeLegacyRule({
      assignmentType: "QUEUE",
      assigneeUserId: null,
      assigneeQueueId: "queue-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockGetSfdcQueueId).toHaveBeenCalledWith("queue-1");
    expect(mockUpdateOwner).toHaveBeenCalledWith({}, "Lead", "00Q000000000001", "00GSFDC_QUEUE");
  });

  it("uses queue name from DB in the log", async () => {
    const rule = makeLegacyRule({
      assignmentType: "QUEUE",
      assigneeUserId: null,
      assigneeQueueId: "queue-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);
    mockPrisma.sfdcQueue.findUnique.mockResolvedValue({ name: "Enterprise Queue" });

    await routeRecord(makePayload());

    // The log should have the queue name as assigneeName
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeName: "Enterprise Queue",
          assignmentType: "QUEUE",
        }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Legacy routing — dry-run mode
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — legacy dry-run mode", () => {
  it("returns 'dry_run' without calling updateOwner", async () => {
    const rule = makeLegacyRule({ isDryRun: true });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    expect(result).toBe("dry_run");
    expect(mockUpdateOwner).not.toHaveBeenCalled();
    expect(mockPrisma.routingLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SUCCESS" } })
    );
  });

  it("does not fire webhook in dry-run mode", async () => {
    const rule = makeLegacyRule({ isDryRun: true });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    await routeRecord(makePayload());

    expect(mockFireWebhook).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Legacy routing — SFDC error → enqueue retry
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — legacy SFDC error handling", () => {
  it("enqueues retry on SFDC updateOwner failure", async () => {
    const rule = makeLegacyRule();
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);
    mockUpdateOwner.mockRejectedValue(new Error("SFDC timeout"));

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockEnqueueRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: "log-1",
        orgId: "org-1",
        recordId: "00Q000000000001",
        objectType: "Lead",
        ownerId: "005SFDC_USER",
      })
    );
  });

  it("enqueues retry on getOrgConnection failure", async () => {
    const rule = makeLegacyRule();
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);
    mockGetOrgConnection.mockRejectedValue(new Error("Connection failed"));

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockEnqueueRetry).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Legacy routing — no eligible assignee
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — legacy no assignee", () => {
  it("returns 'unmatched' when assignmentType has no matching field", async () => {
    const rule = makeLegacyRule({
      assignmentType: "USER",
      assigneeUserId: null, // no user ID
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    expect(result).toBe("unmatched");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "No eligible assignee found",
        }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. New-style routing — branch evaluation
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — new-style branch evaluation", () => {
  it("routes via first matching branch", async () => {
    const rule = makeNewStyleRule();
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockUpdateOwner).toHaveBeenCalled();
    expect(mockFireWebhook).toHaveBeenCalled();
  });

  it("evaluates branches in priority order, first match wins", async () => {
    const branch1 = makeBranch({ id: "b1", priority: 1, label: "Path 1" });
    const branch2 = makeBranch({ id: "b2", priority: 2, label: "Path 2" });
    const rule = makeNewStyleRule({ branches: [branch1, branch2] });
    mockGetActiveRules.mockReturnValue([rule]);
    // Only second branch matches
    mockEvaluateRule.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pathLabel: "Path 2" }),
      })
    );
  });

  it("uses default path label when branch label is null", async () => {
    const branch = makeBranch({ label: null });
    const rule = makeNewStyleRule({ branches: [branch] });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    await routeRecord(makePayload());

    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pathLabel: "Path 1" }),
      })
    );
  });

  it("skips branch with no eligible assignee and tries next", async () => {
    const branch1 = makeBranch({
      id: "b1", priority: 1, assignmentType: "USER", assigneeUserId: null,
    });
    const branch2 = makeBranch({
      id: "b2", priority: 2, label: "Fallback",
      assignmentType: "QUEUE", assigneeQueueId: "queue-1",
    });
    const rule = makeNewStyleRule({ branches: [branch1, branch2] });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockGetSfdcQueueId).toHaveBeenCalledWith("queue-1");
  });

  it("returns 'dry_run' in new-style when isDryRun is true", async () => {
    const rule = makeNewStyleRule({ isDryRun: true });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    expect(result).toBe("dry_run");
    expect(mockUpdateOwner).not.toHaveBeenCalled();
    expect(mockPrisma.routingLog.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "SUCCESS" } })
    );
  });

  it("enqueues retry on SFDC failure during branch routing", async () => {
    const rule = makeNewStyleRule();
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);
    mockUpdateOwner.mockRejectedValue(new Error("SFDC down"));

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockEnqueueRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: "log-1",
        orgId: "org-1",
        objectType: "Lead",
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. New-style routing — default owner fallback
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — new-style default owner fallback", () => {
  it("routes to default owner when no branches match", async () => {
    const rule = makeNewStyleRule({
      branches: [makeBranch()],
      defaultOwnerType: "USER",
      defaultOwnerUserId: "default-user-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);
    // Branch conditions don't match
    mockEvaluateRule.mockReturnValue(false);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockGetSfdcUserId).toHaveBeenCalledWith("default-user-1");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pathLabel: "Default Owner" }),
      })
    );
  });

  it("returns 'dry_run' for default owner when isDryRun is true", async () => {
    const rule = makeNewStyleRule({
      branches: [makeBranch()],
      isDryRun: true,
      defaultOwnerType: "USER",
      defaultOwnerUserId: "default-user-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(false);

    const result = await routeRecord(makePayload());

    expect(result).toBe("dry_run");
    expect(mockUpdateOwner).not.toHaveBeenCalled();
  });

  it("enqueues retry on SFDC failure for default owner", async () => {
    const rule = makeNewStyleRule({
      branches: [makeBranch()],
      defaultOwnerType: "QUEUE",
      defaultOwnerQueueId: "queue-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(false);
    mockUpdateOwner.mockRejectedValue(new Error("SFDC error"));

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockEnqueueRetry).toHaveBeenCalled();
  });

  it("returns 'unmatched' when no branches match and no default owner", async () => {
    const rule = makeNewStyleRule({
      branches: [makeBranch()],
      defaultOwnerType: null,
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(false);

    const result = await routeRecord(makePayload());

    expect(result).toBe("unmatched");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "UNMATCHED",
          ruleId: "rule-1",
        }),
      })
    );
  });

  it("returns 'unmatched' when default owner resolves to null", async () => {
    const rule = makeNewStyleRule({
      branches: [makeBranch()],
      defaultOwnerType: "USER",
      defaultOwnerUserId: null, // no user ID → resolveAssigneeFromFields returns null
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(false);

    const result = await routeRecord(makePayload());

    expect(result).toBe("unmatched");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. New-style routing — match step: Lead matching
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — match step: lead matching", () => {
  function makeSfdcConn(findOneResult: any = null) {
    const mockFindOne = vi.fn().mockResolvedValue(findOneResult);
    return { sobject: vi.fn(() => ({ findOne: mockFindOne })), _mockFindOne: mockFindOne };
  }

  it("assigns to matched lead owner with onLeadMatch=ASSIGN_TO_OWNER", async () => {
    const conn = makeSfdcConn({ Id: "00QLEAD2", OwnerId: "005LEAD_OWNER" });
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({ onLeadMatch: "ASSIGN_TO_OWNER" });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [] });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockUpdateOwner).toHaveBeenCalledWith(conn, "Lead", "00Q000000000001", "005LEAD_OWNER");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeName: "Matched Lead Owner",
          status: "SUCCESS",
        }),
      })
    );
  });

  it("skips SFDC update in dry-run for lead match ASSIGN_TO_OWNER", async () => {
    const conn = makeSfdcConn({ Id: "00QLEAD2", OwnerId: "005LEAD_OWNER" });
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({ onLeadMatch: "ASSIGN_TO_OWNER" });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [], isDryRun: true });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockUpdateOwner).not.toHaveBeenCalled();
  });

  it("merges lead with onLeadMatch=SFDC_MERGE", async () => {
    const conn = makeSfdcConn({ Id: "00QLEAD_MASTER", OwnerId: "005X" });
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({ onLeadMatch: "SFDC_MERGE" });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [] });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("merged");
    expect(mockMergeLead).toHaveBeenCalledWith(conn, "00QLEAD_MASTER", "00Q000000000001");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "MERGED" }),
      })
    );
  });

  it("skips merge in dry-run for SFDC_MERGE and still returns 'merged'", async () => {
    const conn = makeSfdcConn({ Id: "00QLEAD_MASTER", OwnerId: "005X" });
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({ onLeadMatch: "SFDC_MERGE" });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [], isDryRun: true });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("merged");
    expect(mockMergeLead).not.toHaveBeenCalled();
  });

  it("logs FAILED and returns 'unmatched' when merge throws", async () => {
    const conn = makeSfdcConn({ Id: "00QLEAD_MASTER", OwnerId: "005X" });
    mockGetOrgConnection.mockResolvedValue(conn);
    mockMergeLead.mockRejectedValue(new Error("Merge conflict"));

    const mc = makeMatchConfig({ onLeadMatch: "SFDC_MERGE" });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [] });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("unmatched");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      })
    );
  });

  it("routes to custom assignee with onLeadMatch=ASSIGN_CUSTOM", async () => {
    const conn = makeSfdcConn({ Id: "00QLEAD2", OwnerId: "005X" });
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({
      onLeadMatch: "ASSIGN_CUSTOM",
      leadAssignmentType: "USER",
      leadAssigneeUserId: "custom-user-1",
    });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [] });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockGetSfdcUserId).toHaveBeenCalledWith("custom-user-1");
    expect(mockUpdateOwner).toHaveBeenCalledWith(conn, "Lead", "00Q000000000001", "005SFDC_USER");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. New-style routing — match step: Contact matching
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — match step: contact matching", () => {
  function makeSfdcConn(leadResult: any, contactResult: any) {
    const mockFindOne = vi.fn();
    mockFindOne.mockResolvedValueOnce(leadResult).mockResolvedValueOnce(contactResult);
    return { sobject: vi.fn(() => ({ findOne: mockFindOne })), _mockFindOne: mockFindOne };
  }

  it("assigns to matched contact owner with onContactMatch=ASSIGN_TO_OWNER", async () => {
    const conn = makeSfdcConn(
      null, // no lead match
      { Id: "003CONTACT1", OwnerId: "005CONTACT_OWNER" },
    );
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({ onContactMatch: "ASSIGN_TO_OWNER" });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [] });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockUpdateOwner).toHaveBeenCalledWith(conn, "Lead", "00Q000000000001", "005CONTACT_OWNER");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeName: "Matched Contact Owner" }),
      })
    );
  });

  it("routes to custom assignee with onContactMatch=ASSIGN_CUSTOM", async () => {
    const conn = makeSfdcConn(
      null,
      { Id: "003CONTACT1", OwnerId: "005X" },
    );
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({
      onContactMatch: "ASSIGN_CUSTOM",
      contactAssignmentType: "QUEUE",
      contactAssigneeQueueId: "queue-1",
    });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [] });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockGetSfdcQueueId).toHaveBeenCalledWith("queue-1");
  });

  it("falls through to branches with onContactMatch=SKIP", async () => {
    const conn = makeSfdcConn(
      null,
      { Id: "003CONTACT1", OwnerId: "005X" },
    );
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({
      onContactMatch: "SKIP" as any,
    });
    const branch = makeBranch();
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [branch] });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    // Should fall through to branch evaluation and route
    expect(result).toBe("routed");
    expect(mockEvaluateRule).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. New-style routing — match step: Account matching
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — match step: account matching", () => {
  function makeSfdcConn(leadResult: any, contactResult: any, accountResult: any) {
    const mockFindOne = vi.fn();
    mockFindOne
      .mockResolvedValueOnce(leadResult)
      .mockResolvedValueOnce(contactResult)
      .mockResolvedValueOnce(accountResult);
    return { sobject: vi.fn(() => ({ findOne: mockFindOne })), _mockFindOne: mockFindOne };
  }

  it("assigns to matched account owner with onAccountMatch=ASSIGN_TO_OWNER", async () => {
    const conn = makeSfdcConn(
      null,
      null,
      { Id: "001ACCOUNT1", OwnerId: "005ACCT_OWNER" },
    );
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({
      checkAccounts: true,
      matchDomain: true,
      onAccountMatch: "ASSIGN_TO_OWNER",
    });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [] });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockUpdateOwner).toHaveBeenCalledWith(conn, "Lead", "00Q000000000001", "005ACCT_OWNER");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeName: "Matched Account Owner" }),
      })
    );
  });

  it("routes to custom assignee with onAccountMatch=ASSIGN_CUSTOM", async () => {
    const conn = makeSfdcConn(
      null,
      null,
      { Id: "001ACCOUNT1", OwnerId: "005X" },
    );
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({
      checkAccounts: true,
      matchDomain: true,
      onAccountMatch: "ASSIGN_CUSTOM",
      accountAssignmentType: "USER",
      accountAssigneeUserId: "acct-user-1",
    });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [] });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockGetSfdcUserId).toHaveBeenCalledWith("acct-user-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 14. Match step — connection failure gracefully falls through
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — match step connection failure", () => {
  it("skips match step and proceeds to branches when getOrgConnection fails", async () => {
    mockGetOrgConnection.mockRejectedValue(new Error("No SFDC connection"));

    const mc = makeMatchConfig();
    const branch = makeBranch();
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [branch] });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    // Reset getOrgConnection for the branch routing call
    mockGetOrgConnection
      .mockRejectedValueOnce(new Error("No SFDC connection"))
      .mockResolvedValueOnce({});

    const result = await routeRecord(makePayload());

    // Should fall through to branch evaluation
    expect(result).toBe("routed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 15. Match step — no match found falls through to branches
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — match step no match found", () => {
  it("proceeds to branches when no SFDC match is found", async () => {
    const mockFindOne = vi.fn().mockResolvedValue(null);
    const conn = { sobject: vi.fn(() => ({ findOne: mockFindOne })) };
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig();
    const branch = makeBranch();
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [branch] });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockEvaluateRule).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 16. Match step — phone-based matching
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — match step: phone matching", () => {
  it("matches a lead by phone when matchPhone is true", async () => {
    const mockFindOne = vi.fn();
    // email lead check = no match, email contact check = no match, phone lead check = match
    mockFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ Id: "00QPHONE_LEAD", OwnerId: "005PHONE_OWNER" });
    const conn = { sobject: vi.fn(() => ({ findOne: mockFindOne })) };
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({
      matchPhone: true,
      checkAccounts: false,
      onLeadMatch: "ASSIGN_TO_OWNER",
    });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [] });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(
      makePayload({ fields: { Email: "test@example.com", Phone: "+15551234567" } })
    );

    expect(result).toBe("routed");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeName: "Matched Lead Owner" }),
      })
    );
  });

  it("matches a contact by phone when matchPhone is true and checkLeads is false", async () => {
    const mockFindOne = vi.fn();
    // checkLeads=false so no lead queries; email contact = no match, phone contact = match
    mockFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ Id: "003PHONE_CONTACT", OwnerId: "005PHONE_COWNER" });
    const conn = { sobject: vi.fn(() => ({ findOne: mockFindOne })) };
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({
      matchPhone: true,
      checkLeads: false,
      checkAccounts: false,
      onContactMatch: "ASSIGN_TO_OWNER",
    });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [] });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(
      makePayload({ fields: { Email: "test@example.com", Phone: "+15551234567" } })
    );

    expect(result).toBe("routed");
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeName: "Matched Contact Owner" }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 17. Multiple rules — first match wins
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — multiple rules priority", () => {
  it("stops at the first rule that produces a result", async () => {
    const rule1 = makeLegacyRule({ id: "rule-1", name: "First Rule" });
    const rule2 = makeLegacyRule({ id: "rule-2", name: "Second Rule" });
    mockGetActiveRules.mockReturnValue([rule1, rule2]);
    mockEvaluateRule.mockReturnValue(true);

    await routeRecord(makePayload());

    // Only first rule should trigger routing
    expect(mockEvaluateRule).toHaveBeenCalledTimes(1);
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ruleName: "First Rule" }),
      })
    );
  });

  it("tries second rule when first rule conditions do not match", async () => {
    const rule1 = makeLegacyRule({ id: "rule-1", name: "First Rule" });
    const rule2 = makeLegacyRule({ id: "rule-2", name: "Second Rule" });
    mockGetActiveRules.mockReturnValue([rule1, rule2]);
    // First rule fails, second succeeds
    mockEvaluateRule.mockReturnValueOnce(false).mockReturnValueOnce(true);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockEvaluateRule).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 18. New-style rule detection
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — new-style vs legacy detection", () => {
  it("treats rule as new-style when it has branches", async () => {
    const rule = makeLegacyRule({
      branches: [makeBranch()],
      conditions: [{ groupId: "g1", fieldName: "x", operator: "equals", value: "y" }],
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    // New-style calls evaluateRule for branches, not for the rule itself as legacy would
    expect(result).toBe("routed");
  });

  it("treats rule as new-style when it has matchConfig", async () => {
    const mockFindOne = vi.fn().mockResolvedValue(null);
    const conn = { sobject: vi.fn(() => ({ findOne: mockFindOne })) };
    mockGetOrgConnection.mockResolvedValue(conn);

    const rule = makeLegacyRule({
      matchConfig: makeMatchConfig(),
      branches: [],
      defaultOwnerType: null,
    });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    // No branches, no default → unmatched (but goes through new-style path)
    expect(result).toBe("unmatched");
    // The UNMATCHED log should include the ruleId from the new-style path
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ruleId: "rule-1", status: "UNMATCHED" }),
      })
    );
  });

  it("treats rule as new-style when it has defaultOwnerType", async () => {
    const rule = makeLegacyRule({
      branches: [],
      matchConfig: null,
      defaultOwnerType: "USER",
      defaultOwnerUserId: "default-user-1",
      conditions: [],
    });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockGetSfdcUserId).toHaveBeenCalledWith("default-user-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 19. Match step — SOQL error handling
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — match step SOQL errors", () => {
  it("returns null match when query throws, falls through to branches", async () => {
    const mockFindOne = vi.fn().mockRejectedValue(new Error("Query error"));
    const conn = { sobject: vi.fn(() => ({ findOne: mockFindOne })) };
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig();
    const branch = makeBranch();
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [branch] });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const result = await routeRecord(makePayload());

    // Should gracefully fall through SOQL errors and reach branches
    expect(result).toBe("routed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 20. Match step — no email/phone fields
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — match step with missing email/phone", () => {
  it("skips email-based checks when Email field is empty", async () => {
    const mockFindOne = vi.fn().mockResolvedValue(null);
    const conn = { sobject: vi.fn(() => ({ findOne: mockFindOne })) };
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({ checkLeads: true, checkContacts: true });
    const rule = makeNewStyleRule({
      matchConfig: mc,
      branches: [],
      defaultOwnerType: "USER",
      defaultOwnerUserId: "default-user-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);

    await routeRecord(makePayload({ fields: { Company: "Acme" } }));

    // No findOne calls should be made (no email)
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("skips phone-based checks when Phone field is empty", async () => {
    const mockFindOne = vi.fn();
    // email lead check + email contact check
    mockFindOne.mockResolvedValue(null);
    const conn = { sobject: vi.fn(() => ({ findOne: mockFindOne })) };
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({ matchPhone: true, checkAccounts: false });
    const rule = makeNewStyleRule({
      matchConfig: mc,
      branches: [],
      defaultOwnerType: "USER",
      defaultOwnerUserId: "default-user-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);

    await routeRecord(makePayload({ fields: { Email: "test@example.com" } }));

    // Should have email queries but no phone queries
    // Lead by email + Contact by email = 2 findOne calls (no phone queries)
    expect(mockFindOne).toHaveBeenCalledTimes(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 21. Record snapshot stored in logs
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — recordSnapshot in logs", () => {
  it("includes stripPii(fields) as recordSnapshot in all log entries", async () => {
    mockGetActiveRules.mockReturnValue([]);
    const fields = { Email: "test@example.com", Company: "Acme", Revenue: 100000 };
    await routeRecord(makePayload({ fields }));

    // Email is a PII field and gets redacted by stripPii()
    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recordSnapshot: { Email: "[REDACTED]", Company: "Acme", Revenue: 100000 },
        }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 22. User name fallback
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — user name fallback", () => {
  it("falls back to SFDC ID as assigneeName when user.name is null", async () => {
    const rule = makeLegacyRule();
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);
    mockPrisma.user.findUnique.mockResolvedValue({ name: null });

    await routeRecord(makePayload());

    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeName: "005SFDC_USER" }),
      })
    );
  });

  it("falls back to SFDC ID as assigneeName when queue.name is null", async () => {
    const rule = makeLegacyRule({
      assignmentType: "QUEUE",
      assigneeUserId: null,
      assigneeQueueId: "queue-1",
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);
    mockPrisma.sfdcQueue.findUnique.mockResolvedValue({ name: null });

    await routeRecord(makePayload());

    expect(mockPrisma.routingLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeName: "00GSFDC_QUEUE" }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 23. Branch ROUND_ROBIN assignment
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — branch ROUND_ROBIN assignment", () => {
  it("routes via round-robin in a branch", async () => {
    const branch = makeBranch({
      assignmentType: "ROUND_ROBIN",
      assigneeUserId: null,
      assigneeTeamId: "team-1",
    });
    const rule = makeNewStyleRule({ branches: [branch] });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(true);

    const members = [
      {
        id: "tm-1", userId: "user-1", status: "ACTIVE", teamId: "team-1",
        assignmentCount: 0, createdAt: new Date(),
        user: { id: "user-1", sfdcUserId: "005RR", name: "Charlie", email: "charlie@test.com" },
      },
    ];
    mockPrisma.teamMember.findMany.mockResolvedValue(members);
    mockGetNextMember.mockResolvedValue({
      id: "tm-1", userId: "user-1", name: "Charlie", email: "charlie@test.com", assignmentCount: 0,
    });

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockUpdateOwner).toHaveBeenCalledWith({}, "Lead", "00Q000000000001", "005RR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 24. Default owner ROUND_ROBIN assignment
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — default owner ROUND_ROBIN", () => {
  it("routes via round-robin as default owner fallback", async () => {
    const rule = makeNewStyleRule({
      branches: [makeBranch()],
      defaultOwnerType: "ROUND_ROBIN",
      defaultOwnerTeamId: "team-default",
    });
    mockGetActiveRules.mockReturnValue([rule]);
    mockEvaluateRule.mockReturnValue(false); // no branch matches

    const members = [
      {
        id: "tm-d1", userId: "user-d1", status: "ACTIVE", teamId: "team-default",
        assignmentCount: 5, createdAt: new Date(),
        user: { id: "user-d1", sfdcUserId: "005DEFAULT_RR", name: "DefaultUser", email: "d@t.com" },
      },
    ];
    mockPrisma.teamMember.findMany.mockResolvedValue(members);
    mockGetNextMember.mockResolvedValue({
      id: "tm-d1", userId: "user-d1", name: "DefaultUser", email: "d@t.com", assignmentCount: 5,
    });

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockUpdateOwner).toHaveBeenCalledWith(
      expect.anything(), "Lead", "00Q000000000001", "005DEFAULT_RR"
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 25. Match step — dry-run for ASSIGN_CUSTOM on contact/account
// ═══════════════════════════════════════════════════════════════════════════

describe("routeRecord — match step dry-run for custom assignment", () => {
  it("skips updateOwner in dry-run for contact ASSIGN_CUSTOM", async () => {
    const mockFindOne = vi.fn();
    mockFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ Id: "003C", OwnerId: "005X" });
    const conn = { sobject: vi.fn(() => ({ findOne: mockFindOne })) };
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({
      onContactMatch: "ASSIGN_CUSTOM",
      contactAssignmentType: "USER",
      contactAssigneeUserId: "custom-contact-user",
    });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [], isDryRun: true });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockUpdateOwner).not.toHaveBeenCalled();
  });

  it("skips updateOwner in dry-run for account ASSIGN_TO_OWNER", async () => {
    const mockFindOne = vi.fn();
    mockFindOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ Id: "001A", OwnerId: "005ACCT" });
    const conn = { sobject: vi.fn(() => ({ findOne: mockFindOne })) };
    mockGetOrgConnection.mockResolvedValue(conn);

    const mc = makeMatchConfig({
      checkAccounts: true,
      matchDomain: true,
      onAccountMatch: "ASSIGN_TO_OWNER",
    });
    const rule = makeNewStyleRule({ matchConfig: mc, branches: [], isDryRun: true });
    mockGetActiveRules.mockReturnValue([rule]);

    const result = await routeRecord(makePayload());

    expect(result).toBe("routed");
    expect(mockUpdateOwner).not.toHaveBeenCalled();
  });
});
