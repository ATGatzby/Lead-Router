import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetOrgIdFromHeaders = vi.hoisted(() => vi.fn().mockResolvedValue("org-1"));
const mockGetActorFromHeaders = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    orgId: "org-1",
    userId: "actor-1",
    userName: "Admin",
  })
);
const mockRequireSession = vi.hoisted(() => vi.fn().mockResolvedValue({ role: "ADMIN" }));
const mockRequireRole = vi.hoisted(() => vi.fn());

const mockPrisma = vi.hoisted(() => ({
  roundRobinTeam: {
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  routingRule: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  auditLog: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/lib/auth", () => ({
  getOrgIdFromHeaders: mockGetOrgIdFromHeaders,
  getActorFromHeaders: mockGetActorFromHeaders,
  requireSession: mockRequireSession,
  requireRole: mockRequireRole,
}));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { GET, PUT } from "./route";
import { NextRequest } from "next/server";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeGetRequest() {
  return new NextRequest("http://localhost/api/teams/team-1", {
    method: "GET",
  });
}

function makePutRequest(body: unknown) {
  return new NextRequest("http://localhost/api/teams/team-1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = Promise.resolve({ id: "team-1" });

// ─── Fixtures ────────────────────────────────────────────────────────────────

const now = new Date();

function teamWithMembers(overrides: Record<string, unknown> = {}) {
  return {
    id: "team-1",
    name: "Sales Team",
    description: "Primary sales team",
    distributionType: "round-robin",
    pointerIndex: 0,
    createdAt: now,
    members: [
      {
        id: "tm-1",
        userId: "u1",
        status: "ACTIVE",
        weight: 50,
        assignmentCount: 10,
        createdAt: now,
        user: { id: "u1", name: "Alice", email: "alice@example.com" },
      },
      {
        id: "tm-2",
        userId: "u2",
        status: "ACTIVE",
        weight: 30,
        assignmentCount: 6,
        createdAt: now,
        user: { id: "u2", name: "Bob", email: "bob@example.com" },
      },
      {
        id: "tm-3",
        userId: "u3",
        status: "PAUSED",
        weight: 20,
        assignmentCount: 4,
        createdAt: now,
        user: { id: "u3", name: "Carol", email: "carol@example.com" },
      },
    ],
    ...overrides,
  };
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgIdFromHeaders.mockResolvedValue("org-1");
  mockGetActorFromHeaders.mockResolvedValue({
    orgId: "org-1",
    userId: "actor-1",
    userName: "Admin",
  });
  mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(teamWithMembers());
  mockPrisma.roundRobinTeam.update.mockResolvedValue({
    id: "team-1",
    name: "Sales Team",
    distributionType: "round-robin",
  });
  mockPrisma.auditLog.create.mockResolvedValue({});
});

// ─── GET Tests ───────────────────────────────────────────────────────────────

describe("GET /api/teams/:id", () => {
  it("returns team with distributionType and per-member weight", async () => {
    const res = await GET(makeGetRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.team.distributionType).toBe("round-robin");
    expect(body.team.members).toHaveLength(3);
    expect(body.team.members[0].weight).toBe(50);
    expect(body.team.members[1].weight).toBe(30);
    expect(body.team.members[2].weight).toBe(20);
  });

  it("returns correct member stats and share percentages", async () => {
    const res = await GET(makeGetRequest(), { params });
    const body = await res.json();

    // totalAssigned = 10 + 6 + 4 = 20
    expect(body.team.totalAssigned).toBe(20);
    expect(body.team.members[0].sharePercent).toBe(50); // 10/20 = 50%
    expect(body.team.members[1].sharePercent).toBe(30); // 6/20 = 30%
    expect(body.team.members[2].sharePercent).toBe(20); // 4/20 = 20%
  });

  it("returns nextMember based on pointerIndex modulo active members", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(
      teamWithMembers({ pointerIndex: 3 })
    );

    const res = await GET(makeGetRequest(), { params });
    const body = await res.json();

    // 2 active members (Alice, Bob — Carol is PAUSED). 3 % 2 = 1 → Bob
    expect(body.team.nextMemberId).toBe("u2");
    expect(body.team.nextMemberName).toBe("Bob");
  });

  it("returns null nextMember when no active members", async () => {
    const noActive = teamWithMembers();
    noActive.members = noActive.members.map((m: Record<string, unknown>) => ({
      ...m,
      status: "PAUSED",
    }));
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(noActive);

    const res = await GET(makeGetRequest(), { params });
    const body = await res.json();

    expect(body.team.nextMemberId).toBeNull();
    expect(body.team.nextMemberName).toBeNull();
  });

  it("returns 404 when team not found", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(null);

    const res = await GET(makeGetRequest(), { params });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Team not found");
  });

  it("returns distributionType = weighted for weighted teams", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(
      teamWithMembers({ distributionType: "weighted" })
    );

    const res = await GET(makeGetRequest(), { params });
    const body = await res.json();

    expect(body.team.distributionType).toBe("weighted");
  });

  it("returns 0 sharePercent when totalAssigned is 0", async () => {
    const noAssignments = teamWithMembers();
    noAssignments.members = noAssignments.members.map((m: Record<string, unknown>) => ({
      ...m,
      assignmentCount: 0,
    }));
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(noAssignments);

    const res = await GET(makeGetRequest(), { params });
    const body = await res.json();

    expect(body.team.totalAssigned).toBe(0);
    body.team.members.forEach((m: { sharePercent: number }) => {
      expect(m.sharePercent).toBe(0);
    });
  });
});

// ─── PUT Tests ───────────────────────────────────────────────────────────────

describe("PUT /api/teams/:id", () => {
  it("updates distributionType only (no name)", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue({
      id: "team-1",
      name: "Sales Team",
      description: null,
      distributionType: "round-robin",
    });
    mockPrisma.roundRobinTeam.update.mockResolvedValue({
      id: "team-1",
      name: "Sales Team",
      distributionType: "weighted",
    });

    const res = await PUT(
      makePutRequest({ distributionType: "weighted" }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.team.distributionType).toBe("weighted");
    expect(mockPrisma.roundRobinTeam.update).toHaveBeenCalledWith({
      where: { id: "team-1", orgId: "org-1" },
      data: { distributionType: "weighted" },
    });
  });

  it("rejects invalid distributionType", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue({
      id: "team-1",
      name: "Sales Team",
      description: null,
      distributionType: "round-robin",
    });

    const res = await PUT(
      makePutRequest({ distributionType: "random" }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/distributionType must be/);
  });

  it("rejects empty body (no fields to update)", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue({
      id: "team-1",
      name: "Sales Team",
      description: null,
      distributionType: "round-robin",
    });

    const res = await PUT(makePutRequest({}), { params });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/No fields to update/);
  });

  it("updates both name and distributionType together", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue({
      id: "team-1",
      name: "Sales Team",
      description: null,
      distributionType: "round-robin",
    });
    mockPrisma.roundRobinTeam.update.mockResolvedValue({
      id: "team-1",
      name: "Enterprise Team",
      distributionType: "weighted",
    });

    const res = await PUT(
      makePutRequest({ name: "Enterprise Team", distributionType: "weighted" }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.roundRobinTeam.update).toHaveBeenCalledWith({
      where: { id: "team-1", orgId: "org-1" },
      data: { name: "Enterprise Team", distributionType: "weighted" },
    });
  });

  it("rejects blank name", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue({
      id: "team-1",
      name: "Sales Team",
      description: null,
      distributionType: "round-robin",
    });

    const res = await PUT(makePutRequest({ name: "  " }), { params });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("name is required");
  });

  it("returns 404 when team not found", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(null);

    const res = await PUT(
      makePutRequest({ distributionType: "weighted" }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Team not found");
  });

  it("creates audit log with before/after state on distributionType change", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue({
      id: "team-1",
      name: "Sales Team",
      description: null,
      distributionType: "round-robin",
    });
    mockPrisma.roundRobinTeam.update.mockResolvedValue({
      id: "team-1",
      name: "Sales Team",
      distributionType: "weighted",
    });

    await PUT(makePutRequest({ distributionType: "weighted" }), { params });

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "TEAM_UPDATED",
        beforeState: expect.objectContaining({ distributionType: "round-robin" }),
        afterState: expect.objectContaining({ distributionType: "weighted" }),
      }),
    });
  });

  it("returns 500 when auth fails", async () => {
    mockGetActorFromHeaders.mockRejectedValue(new Error("Unauthenticated"));

    const res = await PUT(
      makePutRequest({ distributionType: "weighted" }),
      { params }
    );

    expect(res.status).toBe(500);
  });
});
