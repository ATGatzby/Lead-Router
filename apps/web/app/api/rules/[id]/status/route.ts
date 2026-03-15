import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";
import { invalidateRulesCache } from "@/lib/invalidate-rules-cache";
import { syncRoutingFlags } from "@/lib/sync-routing-flags";

// PATCH /api/rules/:id/status — toggle ACTIVE / INACTIVE
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const rule = await prisma.routingRule.findFirst({
      where: { id, orgId },
      select: { id: true, name: true, status: true, objectType: true },
    });
    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    const newStatus = rule.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

    const updated = await prisma.routingRule.update({
      where: { id },
      data: { status: newStatus },
      select: { id: true, status: true },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "RULE_STATUS_CHANGED",
        entityType: "RoutingRule",
        entityId: id,
        beforeState: { status: rule.status },
        afterState: { status: newStatus },
      },
    });

    await invalidateRulesCache(orgId, rule.objectType);
    syncRoutingFlags(orgId).catch(() => {});

    return NextResponse.json({ rule: updated });
  } catch (err) {
    console.error("PATCH /api/rules/:id/status error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
