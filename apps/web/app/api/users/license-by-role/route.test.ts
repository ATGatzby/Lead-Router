import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetActorFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  user: { findMany: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
  organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getActorFromHeaders: mockGetActorFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { POST } from "./route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/users/license-by-role", {
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

describe("POST /api/users/license-by-role", () => {
  it("returns 400 when roles is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/roles must be a non-empty array/);
  });

  it("returns 400 when roles is an empty array", async () => {
    const res = await POST(makeRequest({ roles: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when roles is not an array", async () => {
    const res = await POST(makeRequest({ roles: "AE" }));
    expect(res.status).toBe(400);
  });

  it("returns 500 when auth fails", async () => {
    mockGetActorFromHeaders.mockRejectedValue(new Error("Unauthenticated"));
    const res = await POST(makeRequest({ roles: ["AE"] }));
    expect(res.status).toBe(500);
  });

  it("returns affected: 0 when all matching users are already licensed", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", isLicensed: true },
      { id: "u2", isLicensed: true },
    ]);

    const res = await POST(makeRequest({ roles: ["AE"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ affected: 0, totalMatched: 2 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 402 when seat cap is exceeded", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", isLicensed: false },
      { id: "u2", isLicensed: false },
      { id: "u3", isLicensed: false },
    ]);
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({ seatsPurchased: 5 });
    mockPrisma.user.count.mockResolvedValue(4); // 4 already used, only 1 available

    const res = await POST(makeRequest({ roles: ["AE", "SDR"] }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toBe("seat_cap_exceeded");
    expect(body.seatsPurchased).toBe(5);
    expect(body.seatsUsed).toBe(4);
    expect(body.requested).toBe(3);
    expect(body.available).toBe(1);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("licenses matching unlicensed users and returns affected count", async () => {
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "u1", isLicensed: true },
      { id: "u2", isLicensed: false },
      { id: "u3", isLicensed: false },
    ]);
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({ seatsPurchased: 10 });
    mockPrisma.user.count.mockResolvedValue(3); // 3 used, 7 available

    const res = await POST(makeRequest({ roles: ["AE"] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ affected: 2, totalMatched: 3 });
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });
});
