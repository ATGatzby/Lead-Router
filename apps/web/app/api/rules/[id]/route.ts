import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders, getActorFromHeaders } from "@/lib/auth";
import { invalidateRulesCache } from "@/lib/invalidate-rules-cache";

// GET /api/rules/:id — full rule detail with conditions
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orgId = await getOrgIdFromHeaders();

    const rule = await prisma.routingRule.findFirst({
      where: { id, orgId },
      include: {
        conditions: { orderBy: { sortOrder: "asc" } },
        team: { select: { id: true, name: true } },
        queue: { select: { id: true, name: true } },
      },
    });

    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    // Get assignee user name if needed
    let assigneeUserName: string | null = null;
    if (rule.assignmentType === "USER" && rule.assigneeUserId) {
      const user = await prisma.user.findFirst({
        where: { id: rule.assigneeUserId },
        select: { name: true },
      });
      assigneeUserName = user?.name ?? null;
    }

    return NextResponse.json({
      rule: {
        ...rule,
        assigneeUserName,
        assigneeTeamName: rule.team?.name ?? null,
        assigneeQueueName: rule.queue?.name ?? null,
      },
    });
  } catch (err) {
    console.error("GET /api/rules/:id error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/rules/:id — update rule (replaces conditions wholesale)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const existing = await prisma.routingRule.findFirst({
      where: { id, orgId },
      select: { id: true, name: true, status: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    const body = await req.json();
    const {
      name,
      objectType,
      triggerEvent,
      assignmentType,
      assigneeUserId,
      assigneeTeamId,
      assigneeQueueId,
      isDryRun,
      conditions = [],
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Replace conditions — delete old, create new
    await prisma.ruleCondition.deleteMany({ where: { ruleId: id } });

    const updated = await prisma.routingRule.update({
      where: { id },
      data: {
        name: name.trim(),
        objectType,
        triggerEvent,
        assignmentType,
        assigneeUserId: assignmentType === "USER" ? assigneeUserId : null,
        assigneeTeamId: assignmentType === "ROUND_ROBIN" ? assigneeTeamId : null,
        assigneeQueueId: assignmentType === "QUEUE" ? assigneeQueueId : null,
        isDryRun: isDryRun ?? false,
        conditions: {
          create: conditions.map(
            (c: {
              groupId: string;
              fieldName: string;
              operator: string;
              value?: string | null;
              sortOrder?: number;
            }) => ({
              groupId: c.groupId,
              fieldName: c.fieldName,
              operator: c.operator,
              value: c.value ?? null,
              sortOrder: c.sortOrder ?? 0,
            })
          ),
        },
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "RULE_UPDATED",
        entityType: "RoutingRule",
        entityId: id,
        beforeState: { name: existing.name },
        afterState: { name: updated.name, assignmentType, conditions: conditions.length },
      },
    });

    await invalidateRulesCache(orgId, updated.objectType);

    return NextResponse.json({ rule: updated });
  } catch (err) {
    console.error("PUT /api/rules/:id error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/rules/:id — delete rule
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const rule = await prisma.routingRule.findFirst({
      where: { id, orgId },
      select: { id: true, name: true, objectType: true },
    });
    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    await prisma.routingRule.delete({ where: { id } });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "RULE_DELETED",
        entityType: "RoutingRule",
        entityId: id,
        beforeState: { name: rule.name },
      },
    });

    await invalidateRulesCache(orgId, rule.objectType);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/rules/:id error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
