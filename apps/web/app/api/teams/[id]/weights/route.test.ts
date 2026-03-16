import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetActorFromHeaders = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    orgId: "org-1",
    userId: "actor-1",
    userName: "Admin",
  })
);

const mockPrisma = vi.hoisted(() => ({
  roundRobinTeam: {
    findFirst: vi.fn(),
  },
  teamMember: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
  auditLog: {
    create: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("@/lib/auth", () => ({ getActorFromHeaders: mockGetActorFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/license", () => ({
  getTierLimits: () => ({ weightedDistribution: true }),
  upgradeRequiredResponse: () => Response.json({ error: "upgrade_required" }, { status: 402 }),
}));

import { PUT } from "./route";
import { NextRequest } from "next/server";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/teams/team-1/weights", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

const params = Promise.resolve({ id: "team-1" });

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActorFromHeaders.mockResolvedValue({
    orgId: "org-1",
    userId: "actor-1",
    userName: "Admin",
  });
  // Default: team exists
  mockPrisma.roundRobinTeam.findFirst.mockResolvedValue({ id: "team-1" });
  // Default: 3 members
  mockPrisma.teamMember.findMany.mockResolvedValue([
    { userId: "u1" },
    { userId: "u2" },
    { userId: "u3" },
  ]);
  mockPrisma.$transaction.mockResolvedValue([]);
  mockPrisma.auditLog.create.mockResolvedValue({});
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PUT /api/teams/:id/weights", () => {
  it("succeeds with valid percentage mode (weights sum to 100)", async () => {
    const res = await PUT(
      makeRequest({ mode: "percentage", weights: { u1: 50, u2: 30, u3: 20 } }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "WEIGHTS_UPDATED",
          entityType: "RoundRobinTeam",
          entityId: "team-1",
        }),
      })
    );
  });

  it("succeeds with valid points mode (weights sum to 10)", async () => {
    const res = await PUT(
      makeRequest({ mode: "points", weights: { u1: 5, u2: 3, u3: 2 } }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("rejects invalid mode", async () => {
    const res = await PUT(
      makeRequest({ mode: "random", weights: { u1: 50, u2: 50 } }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/mode must be/);
  });

  it("rejects missing mode", async () => {
    const res = await PUT(
      makeRequest({ weights: { u1: 50, u2: 50 } }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/mode must be/);
  });

  it("rejects empty weights object", async () => {
    const res = await PUT(
      makeRequest({ mode: "percentage", weights: {} }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/must not be empty/);
  });

  it("rejects when weights is null", async () => {
    const res = await PUT(
      makeRequest({ mode: "percentage", weights: null }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/weights must be an object/);
  });

  it("rejects when weights is an array", async () => {
    const res = await PUT(
      makeRequest({ mode: "percentage", weights: [50, 30, 20] }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/weights must be an object/);
  });

  it("rejects non-integer weights (decimals)", async () => {
    const res = await PUT(
      makeRequest({ mode: "percentage", weights: { u1: 33.3, u2: 33.3, u3: 33.4 } }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/must be a non-negative integer/);
  });

  it("rejects negative weights", async () => {
    const res = await PUT(
      makeRequest({ mode: "percentage", weights: { u1: -10, u2: 60, u3: 50 } }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/must be a non-negative integer/);
  });

  it("rejects non-member userId", async () => {
    const res = await PUT(
      makeRequest({
        mode: "percentage",
        weights: { u1: 50, u2: 30, "not-a-member": 20 },
      }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/not-a-member is not a member/);
  });

  it("rejects percentage sum mismatch (does not equal 100)", async () => {
    const res = await PUT(
      makeRequest({ mode: "percentage", weights: { u1: 40, u2: 30, u3: 20 } }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/must sum to 100/);
    expect(body.error).toMatch(/got 90/);
  });

  it("rejects points sum mismatch (does not equal 10)", async () => {
    const res = await PUT(
      makeRequest({ mode: "points", weights: { u1: 5, u2: 3, u3: 1 } }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/must sum to 10/);
    expect(body.error).toMatch(/got 9/);
  });

  it("returns 404 when team not found", async () => {
    mockPrisma.roundRobinTeam.findFirst.mockResolvedValue(null);

    const res = await PUT(
      makeRequest({ mode: "percentage", weights: { u1: 50, u2: 50 } }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Team not found");
  });

  it("returns 500 when auth fails", async () => {
    mockGetActorFromHeaders.mockRejectedValue(new Error("Unauthenticated"));

    const res = await PUT(
      makeRequest({ mode: "percentage", weights: { u1: 100 } }),
      { params }
    );

    expect(res.status).toBe(500);
  });

  it("accepts zero weight for a member as long as sum is correct", async () => {
    const res = await PUT(
      makeRequest({ mode: "percentage", weights: { u1: 100, u2: 0, u3: 0 } }),
      { params }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
  });
});
