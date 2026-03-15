import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetOrgIdFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  organization: { findUniqueOrThrow: vi.fn() },
  user: { count: vi.fn() },
  sfdcQueue: { count: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ getOrgIdFromHeaders: mockGetOrgIdFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { GET } from "./route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest() {
  return new Request("http://localhost/api/users/stats") as any;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgIdFromHeaders.mockResolvedValue("org-1");
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/users/stats", () => {
  it("returns 500 when auth fails", async () => {
    mockGetOrgIdFromHeaders.mockRejectedValue(new Error("Unauthenticated"));
    const res = await GET();
    expect(res.status).toBe(500);
  });

  it("returns seat stats with breakdown object", async () => {
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({
      seatsPurchased: 50,
      seatsUsed: 20,
    });

    // First call = total seatsUsed re-derived, then 4 breakdown counts + licensedQueues
    // The route does Promise.all with 5 calls after the initial user.count
    // Initial user.count (seatsUsed re-derive)
    mockPrisma.user.count
      .mockResolvedValueOnce(18)  // seatsUsed (re-derived)
      .mockResolvedValueOnce(5)   // byRole
      .mockResolvedValueOnce(4)   // byProfile
      .mockResolvedValueOnce(3)   // byCustomField
      .mockResolvedValueOnce(6);  // byIndividual (individual + null)
    mockPrisma.sfdcQueue.count.mockResolvedValue(2); // licensedQueues

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.seatsPurchased).toBe(50);
    expect(body.seatsUsed).toBe(18);
    expect(body.breakdown).toBeDefined();
    expect(body.breakdown).toEqual({
      individual: 6,
      byRole: 5,
      byProfile: 4,
      byCustomField: 3,
      licensedQueues: 2,
    });
  });

  it("returns zero breakdown when no users are licensed", async () => {
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({
      seatsPurchased: 10,
      seatsUsed: 0,
    });

    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.sfdcQueue.count.mockResolvedValue(0);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.seatsPurchased).toBe(10);
    expect(body.seatsUsed).toBe(0);
    expect(body.breakdown).toEqual({
      individual: 0,
      byRole: 0,
      byProfile: 0,
      byCustomField: 0,
      licensedQueues: 0,
    });
  });

  it("breakdown object has all expected keys", async () => {
    mockPrisma.organization.findUniqueOrThrow.mockResolvedValue({
      seatsPurchased: 5,
      seatsUsed: 1,
    });
    mockPrisma.user.count.mockResolvedValue(1);
    mockPrisma.sfdcQueue.count.mockResolvedValue(0);

    const res = await GET();
    const body = await res.json();

    const keys = Object.keys(body.breakdown).sort();
    expect(keys).toEqual(["byCustomField", "byProfile", "byRole", "individual", "licensedQueues"]);
  });
});
