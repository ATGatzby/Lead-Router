import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// POST /api/queues/de-license — remove queue licensing (routing target status)
// NOTE: Queues do NOT consume user seats — no seat adjustment needed
export async function POST(req: NextRequest) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorSfdcId, userName: actorName } = actor;

    const body = await req.json();
    const { queueIds } = body as { queueIds: string[] };

    if (!Array.isArray(queueIds) || queueIds.length === 0) {
      return NextResponse.json({ error: "queueIds must be a non-empty array" }, { status: 400 });
    }

    // Verify all queues belong to this org
    const queues = await prisma.sfdcQueue.findMany({
      where: { id: { in: queueIds }, orgId },
      select: { id: true, name: true, isLicensed: true },
    });
    if (queues.length !== queueIds.length) {
      return NextResponse.json({ error: "One or more queues not found" }, { status: 404 });
    }

    const toDeLicense = queues.filter((q) => q.isLicensed);
    if (toDeLicense.length === 0) {
      return NextResponse.json({ affected: 0 });
    }

    const idsToDeLicense = toDeLicense.map((q) => q.id);
    await prisma.$transaction([
      prisma.sfdcQueue.updateMany({
        where: { id: { in: idsToDeLicense } },
        data: { isLicensed: false },
      }),
      prisma.auditLog.create({
        data: {
          orgId,
          actorId: actorSfdcId,
          actorName,
          action: "QUEUES_DE_LICENSED",
          entityType: "SfdcQueue",
          entityId: idsToDeLicense.join(","),
          beforeState: undefined,
          afterState: { queueIds: idsToDeLicense, isLicensed: false },
        },
      }),
    ]);

    return NextResponse.json({ affected: idsToDeLicense.length });
  } catch (err) {
    console.error("POST /api/queues/de-license error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
