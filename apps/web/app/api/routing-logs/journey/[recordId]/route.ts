import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";

function getOrgIdFromHeaders(req: NextRequest): string | null {
  return req.headers.get("x-org-id");
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ recordId: string }> }
) {
  const orgId = getOrgIdFromHeaders(req);
  if (!orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { recordId } = await params;

  if (!/^[a-zA-Z0-9]{15,18}$/.test(recordId)) {
    return NextResponse.json(
      { error: "Invalid Record ID format" },
      { status: 400 }
    );
  }

  const logs = await prisma.routingLog.findMany({
    where: { orgId, crmRecordId: recordId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
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

  return NextResponse.json({ recordId, entries: logs });
}
