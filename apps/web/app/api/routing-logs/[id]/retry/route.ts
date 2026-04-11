import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { getRoutingQueue, toPascalObjectType } from "@/lib/routing-queue";

// POST /api/routing-logs/:id/retry — re-enqueue failed routing to BullMQ
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const { id } = await params;

    const log = await prisma.routingLog.findUnique({ where: { id } });

    if (!log) {
      return NextResponse.json({ error: "Log not found" }, { status: 404 });
    }
    if (log.orgId !== orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (log.status !== "FAILED" && log.status !== "RETRY") {
      return NextResponse.json({ error: "Only FAILED or RETRY logs can be retried" }, { status: 400 });
    }
    if (!log.assigneeId) {
      return NextResponse.json({ error: "No assignee to retry" }, { status: 400 });
    }

    // Mark as RETRY
    await prisma.routingLog.update({
      where: { id },
      data: { status: "RETRY", dismissed: false },
    });

    // Enqueue to BullMQ
    const queue = getRoutingQueue();
    await queue.add("sfdc-update", {
      logId: id,
      orgId,
      recordId: log.crmRecordId,
      objectType: toPascalObjectType(log.objectType),
      ownerId: log.assigneeId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/routing-logs/[id]/retry error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
