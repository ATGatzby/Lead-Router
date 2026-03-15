import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";

function getOrgIdFromHeaders(req: NextRequest): string | null {
  return req.headers.get("x-org-id");
}

export async function POST(req: NextRequest) {
  const orgId = getOrgIdFromHeaders(req);
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { recordIds?: string[]; limit?: number; since?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { recordIds, limit = 10, since } = body;

  if (!Array.isArray(recordIds) || recordIds.length === 0) {
    return NextResponse.json(
      { error: "recordIds must be a non-empty array" },
      { status: 400 }
    );
  }

  if (recordIds.length > 100) {
    return NextResponse.json(
      { error: "Maximum 100 record IDs per request" },
      { status: 400 }
    );
  }

  const clampedLimit = Math.min(Math.max(1, limit), 50);
  const validIds = recordIds.filter((id) => /^[a-zA-Z0-9]{15,18}$/.test(id));
  const invalidIds = recordIds.filter(
    (id) => !/^[a-zA-Z0-9]{15,18}$/.test(id)
  );

  const where: Record<string, unknown> = {
    orgId,
    sfdcRecordId: { in: validIds },
  };
  if (since) {
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return NextResponse.json({ error: "Invalid since date" }, { status: 400 });
    }
    where.createdAt = { gte: sinceDate };
  }

  const logs = await prisma.routingLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sfdcRecordId: true,
      objectType: true,
      eventType: true,
      status: true,
      ruleName: true,
      pathLabel: true,
      assigneeId: true,
      assigneeName: true,
      assignmentType: true,
      teamName: true,
      routingDurationMs: true,
      decisionTrace: true,
      createdAt: true,
    },
  });

  // Group by recordId
  const grouped: Record<
    string,
    { objectType: string | null; totalEvents: number; entries: unknown[] }
  > = {};

  for (const id of validIds) {
    grouped[id] = { objectType: null, totalEvents: 0, entries: [] };
  }

  for (const log of logs) {
    const rid = log.sfdcRecordId;
    if (!rid || !grouped[rid]) continue;
    grouped[rid].totalEvents++;
    if (!grouped[rid].objectType && log.objectType) {
      grouped[rid].objectType = log.objectType;
    }
    if (grouped[rid].entries.length < clampedLimit) {
      const { sfdcRecordId, objectType, ...entry } = log;
      grouped[rid].entries.push(entry);
    }
  }

  const foundIds = validIds.filter((id) => grouped[id].totalEvents > 0);
  const missingIds = [
    ...validIds.filter((id) => grouped[id].totalEvents === 0),
    ...invalidIds,
  ];

  return NextResponse.json({
    records: grouped,
    meta: {
      requestedIds: recordIds.length,
      foundIds: foundIds.length,
      missingIds,
      truncated: false,
    },
  });
}
