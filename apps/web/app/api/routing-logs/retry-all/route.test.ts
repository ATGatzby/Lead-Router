import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetOrgIdFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  routingLog: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const mockQueueAddBulk = vi.hoisted(() => vi.fn());
const mockGetRoutingQueue = vi.hoisted(() =>
  vi.fn(() => ({ addBulk: mockQueueAddBulk }))
);
const mockToPascalObjectType = vi.hoisted(() =>
  vi.fn((t: string) => {
    const map: Record<string, string> = { LEAD: "Lead", CONTACT: "Contact", ACCOUNT: "Account" };
    return map[t] ?? t;
  })
);

vi.mock("@/lib/auth", () => ({ getOrgIdFromHeaders: mockGetOrgIdFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/routing-queue", () => ({
  getRoutingQueue: mockGetRoutingQueue,
  toPascalObjectType: mockToPascalObjectType,
}));

import { POST } from "./route";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgIdFromHeaders.mockResolvedValue("org-1");
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function parseJson(res: Response) {
  return res.json();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/routing-logs/retry-all", () => {
  it("returns { retried: 0 } when no failed logs exist", async () => {
    mockPrisma.routingLog.findMany.mockResolvedValue([]);

    const res = await POST();
    const body = await parseJson(res);

    expect(res.status).toBe(200);
    expect(body).toEqual({ retried: 0 });
    expect(mockPrisma.routingLog.updateMany).not.toHaveBeenCalled();
    expect(mockQueueAddBulk).not.toHaveBeenCalled();
  });

  it("marks all failed logs as RETRY and enqueues to BullMQ", async () => {
    const logs = [
      { id: "log-1", sfdcRecordId: "00Q001", objectType: "LEAD", assigneeId: "005001" },
      { id: "log-2", sfdcRecordId: "00Q002", objectType: "CONTACT", assigneeId: "005002" },
    ];
    mockPrisma.routingLog.findMany.mockResolvedValue(logs);
    mockPrisma.routingLog.updateMany.mockResolvedValue({ count: 2 });
    mockQueueAddBulk.mockResolvedValue([]);

    const res = await POST();
    const body = await parseJson(res);

    expect(res.status).toBe(200);
    expect(body).toEqual({ retried: 2 });

    // Verify updateMany was called with all log IDs
    expect(mockPrisma.routingLog.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["log-1", "log-2"] } },
      data: { status: "RETRY", dismissed: false },
    });

    // Verify addBulk was called with correct job payloads
    expect(mockQueueAddBulk).toHaveBeenCalledWith([
      {
        name: "sfdc-update",
        data: { logId: "log-1", orgId: "org-1", recordId: "00Q001", objectType: "Lead", ownerId: "005001" },
      },
      {
        name: "sfdc-update",
        data: { logId: "log-2", orgId: "org-1", recordId: "00Q002", objectType: "Contact", ownerId: "005002" },
      },
    ]);
  });

  it("queries only non-dismissed FAILED/RETRY logs with assignees", async () => {
    mockPrisma.routingLog.findMany.mockResolvedValue([]);

    await POST();

    expect(mockPrisma.routingLog.findMany).toHaveBeenCalledWith({
      where: {
        orgId: "org-1",
        status: { in: ["FAILED", "RETRY"] },
        dismissed: false,
        assigneeId: { not: null },
      },
      select: {
        id: true,
        sfdcRecordId: true,
        objectType: true,
        assigneeId: true,
      },
    });
  });

  it("returns 500 when auth fails", async () => {
    mockGetOrgIdFromHeaders.mockRejectedValue(new Error("Missing x-org-id header"));

    const res = await POST();
    const body = await parseJson(res);

    expect(res.status).toBe(500);
    expect(body).toEqual({ error: "Internal server error" });
  });

  it("converts object types to Pascal case via toPascalObjectType", async () => {
    const logs = [
      { id: "log-1", sfdcRecordId: "00Q001", objectType: "ACCOUNT", assigneeId: "005001" },
    ];
    mockPrisma.routingLog.findMany.mockResolvedValue(logs);
    mockPrisma.routingLog.updateMany.mockResolvedValue({ count: 1 });
    mockQueueAddBulk.mockResolvedValue([]);

    await POST();

    expect(mockToPascalObjectType).toHaveBeenCalledWith("ACCOUNT");
    const bulkArgs = mockQueueAddBulk.mock.calls[0][0];
    expect(bulkArgs[0].data.objectType).toBe("Account");
  });
});
