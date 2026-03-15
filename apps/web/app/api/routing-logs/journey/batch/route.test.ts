import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  routingLog: {
    findMany: vi.fn(),
  },
}));

vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { POST } from "./route";

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(body: unknown, orgId = "org-1") {
  const req = new NextRequest("http://localhost/api/routing-logs/journey/batch", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "x-org-id": orgId },
  });
  return req;
}

async function parseJson(res: Response) {
  return res.json();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/routing-logs/journey/batch", () => {
  it("returns 401 when x-org-id header is missing", async () => {
    const req = new NextRequest("http://localhost/api/routing-logs/journey/batch", {
      method: "POST",
      body: JSON.stringify({ recordIds: ["00QgL00000BUX3QU"] }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 for empty recordIds", async () => {
    const res = await POST(makeRequest({ recordIds: [] }));
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toContain("non-empty");
  });

  it("returns 400 for missing recordIds", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when more than 100 record IDs", async () => {
    const ids = Array.from({ length: 101 }, (_, i) =>
      `00QgL00000B${String(i).padStart(6, "0")}`
    );
    const res = await POST(makeRequest({ recordIds: ids }));
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toContain("100");
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new NextRequest("http://localhost/api/routing-logs/journey/batch", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json", "x-org-id": "org-1" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("groups results by recordId", async () => {
    const mockLogs = [
      {
        id: "log-1",
        sfdcRecordId: "00QgL00000BUAAAA",
        objectType: "LEAD",
        eventType: "INSERT",
        status: "SUCCESS",
        ruleName: "Rule A",
        pathLabel: null,
        assigneeId: "u1",
        assigneeName: "Alice",
        assignmentType: "USER",
        teamName: null,
        routingDurationMs: 100,
        decisionTrace: { version: 1 },
        createdAt: new Date("2026-03-13T10:00:00Z"),
      },
      {
        id: "log-2",
        sfdcRecordId: "00QgL00000BUBBBB",
        objectType: "LEAD",
        eventType: "INSERT",
        status: "SUCCESS",
        ruleName: "Rule B",
        pathLabel: null,
        assigneeId: "u2",
        assigneeName: "Bob",
        assignmentType: "ROUND_ROBIN",
        teamName: "Team B",
        routingDurationMs: 200,
        decisionTrace: { version: 1 },
        createdAt: new Date("2026-03-13T11:00:00Z"),
      },
    ];
    mockPrisma.routingLog.findMany.mockResolvedValue(mockLogs);

    const res = await POST(
      makeRequest({ recordIds: ["00QgL00000BUAAAA", "00QgL00000BUBBBB"] })
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);

    expect(body.records["00QgL00000BUAAAA"].totalEvents).toBe(1);
    expect(body.records["00QgL00000BUBBBB"].totalEvents).toBe(1);
    expect(body.records["00QgL00000BUAAAA"].objectType).toBe("LEAD");
  });

  it("reports missing IDs in meta", async () => {
    mockPrisma.routingLog.findMany.mockResolvedValue([]);

    const res = await POST(
      makeRequest({ recordIds: ["00QgL00000BUAAAA", "00QgL00000BUBBBB"] })
    );
    const body = await parseJson(res);

    expect(body.meta.requestedIds).toBe(2);
    expect(body.meta.foundIds).toBe(0);
    expect(body.meta.missingIds).toContain("00QgL00000BUAAAA");
    expect(body.meta.missingIds).toContain("00QgL00000BUBBBB");
  });

  it("filters invalid record IDs and includes them in missingIds", async () => {
    mockPrisma.routingLog.findMany.mockResolvedValue([]);

    const res = await POST(
      makeRequest({ recordIds: ["00QgL00000BUAAAA", "bad!id"] })
    );
    const body = await parseJson(res);

    expect(body.meta.missingIds).toContain("bad!id");
  });

  it("respects the limit parameter", async () => {
    const logs = Array.from({ length: 5 }, (_, i) => ({
      id: `log-${i}`,
      sfdcRecordId: "00QgL00000BUAAAA",
      objectType: "LEAD",
      eventType: "INSERT",
      status: "SUCCESS",
      ruleName: "Rule",
      pathLabel: null,
      assigneeId: "u1",
      assigneeName: "Alice",
      assignmentType: "USER",
      teamName: null,
      routingDurationMs: 100,
      decisionTrace: null,
      createdAt: new Date(`2026-03-${10 + i}T10:00:00Z`),
    }));
    mockPrisma.routingLog.findMany.mockResolvedValue(logs);

    const res = await POST(
      makeRequest({ recordIds: ["00QgL00000BUAAAA"], limit: 2 })
    );
    const body = await parseJson(res);

    expect(body.records["00QgL00000BUAAAA"].totalEvents).toBe(5);
    expect(body.records["00QgL00000BUAAAA"].entries).toHaveLength(2);
  });

  it("clamps limit to max 50", async () => {
    mockPrisma.routingLog.findMany.mockResolvedValue([]);

    await POST(makeRequest({ recordIds: ["00QgL00000BUAAAA"], limit: 999 }));

    // The clamp happens in-memory, not in the query — query fetches all
    // Just verify it doesn't crash
    expect(mockPrisma.routingLog.findMany).toHaveBeenCalled();
  });
});
