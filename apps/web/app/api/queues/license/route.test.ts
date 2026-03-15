import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetActorFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  sfdcQueue: { findMany: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getActorFromHeaders: mockGetActorFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { POST } from "./route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/queues/license", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

const ACTOR = { orgId: "org-1", userId: "005xx0001", userName: "Admin" };

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActorFromHeaders.mockResolvedValue(ACTOR);
  mockPrisma.$transaction.mockResolvedValue(undefined);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/queues/license", () => {
  it("returns 400 when queueIds is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/queueIds must be a non-empty array/);
  });

  it("returns 400 when queueIds is an empty array", async () => {
    const res = await POST(makeRequest({ queueIds: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when queueIds is not an array", async () => {
    const res = await POST(makeRequest({ queueIds: "q1" }));
    expect(res.status).toBe(400);
  });

  it("returns 500 when auth fails", async () => {
    mockGetActorFromHeaders.mockRejectedValue(new Error("Unauthenticated"));
    const res = await POST(makeRequest({ queueIds: ["q1"] }));
    expect(res.status).toBe(500);
  });

  it("returns 404 when some queues are not found in org", async () => {
    mockPrisma.sfdcQueue.findMany.mockResolvedValue([
      { id: "q1", name: "Sales Queue", isLicensed: false },
    ]);
    // Requested 2 but only 1 found
    const res = await POST(makeRequest({ queueIds: ["q1", "q2"] }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/One or more queues not found/);
  });

  it("returns affected: 0 when all queues are already licensed", async () => {
    mockPrisma.sfdcQueue.findMany.mockResolvedValue([
      { id: "q1", name: "Sales Queue", isLicensed: true },
      { id: "q2", name: "Support Queue", isLicensed: true },
    ]);

    const res = await POST(makeRequest({ queueIds: ["q1", "q2"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ affected: 0 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("licenses queues without consuming user seats", async () => {
    mockPrisma.sfdcQueue.findMany.mockResolvedValue([
      { id: "q1", name: "Sales Queue", isLicensed: false },
      { id: "q2", name: "Support Queue", isLicensed: true },
      { id: "q3", name: "Ops Queue", isLicensed: false },
    ]);

    const res = await POST(makeRequest({ queueIds: ["q1", "q2", "q3"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ affected: 2 });
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();

    // Verify no organization.update or user seat-related calls
    const txArgs = mockPrisma.$transaction.mock.calls[0][0];
    // The transaction should contain sfdcQueue.updateMany and auditLog.create only
    // No organization.update for seat increment
    expect(txArgs).toHaveLength(2);
  });
});
