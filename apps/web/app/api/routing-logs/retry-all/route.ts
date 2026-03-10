import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { getRoutingQueue, toPascalObjectType } from "@/lib/routing-queue";

// POST /api/routing-logs/retry-all — re-enqueue all FAILED logs for the org
export async function POST() {
  try {
    const orgId = await getOrgIdFromHeaders();

    // Fetch all non-dismissed FAILED logs with an assignee
    const logs = await prisma.routingLog.findMany({
      where: {
        orgId,
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

    if (logs.length === 0) {
      return NextResponse.json({ retried: 0 });
    }

    // Mark all as RETRY in one query
    await prisma.routingLog.updateMany({
      where: { id: { in: logs.map((l) => l.id) } },
      data: { status: "RETRY", dismissed: false },
    });

    // Enqueue all to BullMQ
    const queue = getRoutingQueue();
    await queue.addBulk(
      logs.map((log) => ({
        name: "sfdc-update",
        data: {
          logId: log.id,
          orgId,
          recordId: log.sfdcRecordId,
          objectType: toPascalObjectType(log.objectType),
          ownerId: log.assigneeId!,
        },
      }))
    );

    return NextResponse.json({ retried: logs.length });
  } catch (err) {
    console.error("POST /api/routing-logs/retry-all error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
