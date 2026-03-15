import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetActorFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  user: { count: vi.fn(), updateMany: vi.fn() },
  organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  auditLog: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getActorFromHeaders: mockGetActorFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { POST } from "./route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/users/license-by-custom-field", {
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

describe("POST /api/users/license-by-custom-field", () => {
  it("returns 400 when fieldName is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/fieldName must be a non-empty string/);
  });

  it("returns 400 when fieldName is empty string", async () => {
    const res = await POST(makeRequest({ fieldName: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when fieldName is not a string", async () => {
    const res = await POST(makeRequest({ fieldName: 123 }));
    expect(res.status).toBe(400);
  });

  it("returns 500 when auth fails", async () => {
    mockGetActorFromHeaders.mockRejectedValue(new Error("Unauthenticated"));
    const res = await POST(makeRequest({ fieldName: "Is_Sales__c" }));
    expect(res.status).toBe(500);
  });

  it("returns affected: 0 when all matching users are already licensed", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { id: "u1", isLicensed: true },
      { id: "u2", isLicensed: true },
    ]);

    const res = await POST(makeRequest({ fieldName: "Is_Sales__c" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ affected: 0, totalMatched: 2 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns 402 when seat cap is exceeded", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { id: "u1", isLicensed: false },
      { id: "u2", isLicensed: false },
    ]);
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({ seatsPurchased: 2 });
    mockPrisma.user.count.mockResolvedValue(2); // 2 used, 0 available

    const res = await POST(makeRequest({ fieldName: "Is_Sales__c" }));
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.error).toBe("seat_cap_exceeded");
    expect(body.seatsPurchased).toBe(2);
    expect(body.seatsUsed).toBe(2);
    expect(body.requested).toBe(2);
    expect(body.available).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("licenses matching unlicensed users and returns affected count", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { id: "u1", isLicensed: true },
      { id: "u2", isLicensed: false },
      { id: "u3", isLicensed: false },
    ]);
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({ seatsPurchased: 20 });
    mockPrisma.user.count.mockResolvedValue(5); // 5 used, 15 available

    const res = await POST(makeRequest({ fieldName: "Is_Sales__c" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ affected: 2, totalMatched: 3 });
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });
});
