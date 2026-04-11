import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetOrgIdFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  routingLog: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
const mockQueueAdd = vi.hoisted(() => vi.fn());
const mockGetRoutingQueue = vi.hoisted(() =>
  vi.fn(() => ({ add: mockQueueAdd }))
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

function makeRequest() {
  return new NextRequest("http://localhost/api/routing-logs/log-1/retry", { method: "POST" });
}

function makeParams(id = "log-1") {
  return { params: Promise.resolve({ id }) };
}

async function parseJson(res: Response) {
  return res.json();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/routing-logs/[id]/retry", () => {
  const baselog = {
    id: "log-1",
    orgId: "org-1",
    status: "FAILED",
    assigneeId: "005001",
    crmRecordId: "00Q001",
    objectType: "LEAD",
  };

  it("returns 404 when log not found", async () => {
    mockPrisma.routingLog.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(), makeParams());
    const body = await parseJson(res);

    expect(res.status).toBe(404);
    expect(body.error).toBe("Log not found");
  });

  it("returns 404 when log belongs to different org", async () => {
    mockPrisma.routingLog.findUnique.mockResolvedValue({ ...baselog, orgId: "org-other" });

    const res = await POST(makeRequest(), makeParams());
    const body = await parseJson(res);

    expect(res.status).toBe(404);
    expect(body.error).toBe("Not found");
  });

  it("returns 400 when log status is SUCCESS (not retryable)", async () => {
    mockPrisma.routingLog.findUnique.mockResolvedValue({ ...baselog, status: "SUCCESS" });

    const res = await POST(makeRequest(), makeParams());
    const body = await parseJson(res);

    expect(res.status).toBe(400);
    expect(body.error).toContain("Only FAILED or RETRY logs can be retried");
  });

  it("allows retry of FAILED logs", async () => {
    mockPrisma.routingLog.findUnique.mockResolvedValue({ ...baselog, status: "FAILED" });
    mockPrisma.routingLog.update.mockResolvedValue({});
    mockQueueAdd.mockResolvedValue(undefined);

    const res = await POST(makeRequest(), makeParams());
    const body = await parseJson(res);

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("allows retry of RETRY logs (stuck records)", async () => {
    mockPrisma.routingLog.findUnique.mockResolvedValue({ ...baselog, status: "RETRY" });
    mockPrisma.routingLog.update.mockResolvedValue({});
    mockQueueAdd.mockResolvedValue(undefined);

    const res = await POST(makeRequest(), makeParams());
    const body = await parseJson(res);

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("returns 400 when log has no assignee", async () => {
    mockPrisma.routingLog.findUnique.mockResolvedValue({ ...baselog, assigneeId: null });

    const res = await POST(makeRequest(), makeParams());
    const body = await parseJson(res);

    expect(res.status).toBe(400);
    expect(body.error).toBe("No assignee to retry");
  });

  it("marks log as RETRY and enqueues to BullMQ on success", async () => {
    mockPrisma.routingLog.findUnique.mockResolvedValue(baselog);
    mockPrisma.routingLog.update.mockResolvedValue({});
    mockQueueAdd.mockResolvedValue(undefined);

    await POST(makeRequest(), makeParams());

    // Verify status update
    expect(mockPrisma.routingLog.update).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { status: "RETRY", dismissed: false },
    });

    // Verify BullMQ enqueue
    expect(mockQueueAdd).toHaveBeenCalledWith("sfdc-update", {
      logId: "log-1",
      orgId: "org-1",
      recordId: "00Q001",
      objectType: "Lead",
      ownerId: "005001",
    });
  });
});
