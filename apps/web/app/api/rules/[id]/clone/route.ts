import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";
import { invalidateRulesCache } from "@/lib/invalidate-rules-cache";

// POST /api/rules/:id/clone — duplicate rule (appends " (Copy)" to name, sets INACTIVE, lowest priority)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const source = await prisma.routingRule.findFirst({
      where: { id, orgId },
      include: { conditions: { orderBy: { sortOrder: "asc" } } },
    });
    if (!source) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    // Get max priority for this object type
    const maxPriorityRule = await prisma.routingRule.findFirst({
      where: { orgId, objectType: source.objectType },
      orderBy: { priority: "desc" },
      select: { priority: true },
    });
    const priority = (maxPriorityRule?.priority ?? 0) + 1;

    const cloned = await prisma.routingRule.create({
      data: {
        orgId,
        name: `${source.name} (Copy)`,
        objectType: source.objectType,
        triggerEvent: source.triggerEvent,
        priority,
        status: "INACTIVE", // clones start inactive
        assignmentType: source.assignmentType,
        assigneeUserId: source.assigneeUserId,
        assigneeTeamId: source.assigneeTeamId,
        assigneeQueueId: source.assigneeQueueId,
        isDryRun: source.isDryRun,
        conditions: {
          create: source.conditions.map((c) => ({
            groupId: c.groupId,
            fieldName: c.fieldName,
            operator: c.operator,
            value: c.value,
            sortOrder: c.sortOrder,
          })),
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "RULE_CLONED",
        entityType: "RoutingRule",
        entityId: cloned.id,
        afterState: { name: cloned.name, sourceId: id },
      },
    });

    await invalidateRulesCache(orgId, cloned.objectType);

    return NextResponse.json({ rule: cloned }, { status: 201 });
  } catch (err) {
    console.error("POST /api/rules/:id/clone error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
