import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  routingLog: {
    findMany: vi.fn(),
  },
}));

vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { GET } from "./route";

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

function makeRequest(recordId: string, orgId = "org-1") {
  const req = new NextRequest(
    `http://localhost/api/routing-logs/journey/${recordId}`
  );
  req.headers.set("x-org-id", orgId);
  return req;
}

function makeParams(recordId: string) {
  return { params: Promise.resolve({ recordId }) };
}

async function parseJson(res: Response) {
  return res.json();
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/routing-logs/journey/[recordId]", () => {
  it("returns 401 when x-org-id header is missing", async () => {
    const req = new NextRequest(
      "http://localhost/api/routing-logs/journey/00QgL00000BUX3QU"
    );
    const res = await GET(req, makeParams("00QgL00000BUX3QU"));
    expect(res.status).toBe(401);
    const body = await parseJson(res);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 for invalid record ID format (too short)", async () => {
    const res = await GET(
      makeRequest("abc"),
      makeParams("abc")
    );
    expect(res.status).toBe(400);
    const body = await parseJson(res);
    expect(body.error).toContain("Invalid");
  });

  it("returns 400 for record ID with special characters", async () => {
    const res = await GET(
      makeRequest("00Q_DROP_TABLE!!"),
      makeParams("00Q_DROP_TABLE!!")
    );
    expect(res.status).toBe(400);
  });

  it("returns entries for a valid record ID", async () => {
    const mockLogs = [
      {
        id: "log-1",
        eventType: "INSERT",
        status: "SUCCESS",
        ruleName: "Test Rule",
        pathLabel: "Path A",
        assigneeId: "user-1",
        assigneeName: "Alice",
        assignmentType: "ROUND_ROBIN",
        teamName: "Team A",
        routingDurationMs: 150,
        decisionTrace: { version: 1, trigger: { event: "INSERT" } },
        createdAt: new Date("2026-03-13T23:34:22Z"),
      },
    ];
    mockPrisma.routingLog.findMany.mockResolvedValue(mockLogs);

    const res = await GET(
      makeRequest("00QgL00000BUX3QU"),
      makeParams("00QgL00000BUX3QU")
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);

    expect(body.recordId).toBe("00QgL00000BUX3QU");
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].id).toBe("log-1");
    expect(body.entries[0].decisionTrace).toBeTruthy();
  });

  it("scopes query to the org from header", async () => {
    mockPrisma.routingLog.findMany.mockResolvedValue([]);

    await GET(
      makeRequest("00QgL00000BUX3QU", "org-42"),
      makeParams("00QgL00000BUX3QU")
    );

    expect(mockPrisma.routingLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: "org-42", sfdcRecordId: "00QgL00000BUX3QU" },
      })
    );
  });

  it("returns empty entries for record with no routing events", async () => {
    mockPrisma.routingLog.findMany.mockResolvedValue([]);

    const res = await GET(
      makeRequest("00QgL00000BNONE1"),
      makeParams("00QgL00000BNONE1")
    );
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.entries).toEqual([]);
  });

  it("accepts 18-character record IDs", async () => {
    mockPrisma.routingLog.findMany.mockResolvedValue([]);

    const res = await GET(
      makeRequest("00QgL00000BUX3QUAX"),
      makeParams("00QgL00000BUX3QUAX")
    );
    expect(res.status).toBe(200);
  });

  it("limits results to 50 entries", async () => {
    mockPrisma.routingLog.findMany.mockResolvedValue([]);

    await GET(
      makeRequest("00QgL00000BUX3QU"),
      makeParams("00QgL00000BUX3QU")
    );

    expect(mockPrisma.routingLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });
});
