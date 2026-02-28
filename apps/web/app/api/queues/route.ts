import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/queues — list synced SFDC queues
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const queues = await prisma.sfdcQueue.findMany({
      where: { orgId },
      orderBy: { name: "asc" },
      select: { id: true, sfdcQueueId: true, name: true, syncedAt: true },
    });

    return NextResponse.json({ queues });
  } catch (err) {
    console.error("GET /api/queues error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
