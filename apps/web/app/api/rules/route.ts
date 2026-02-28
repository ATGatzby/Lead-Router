import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders, getActorFromHeaders } from "@/lib/auth";
import { invalidateRulesCache } from "@/lib/invalidate-rules-cache";

// GET /api/rules?object=LEAD — list rules for object, ordered by priority
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const objectType = req.nextUrl.searchParams.get("object")?.toUpperCase() ?? "LEAD";

    if (!["LEAD", "CONTACT", "ACCOUNT"].includes(objectType)) {
      return NextResponse.json({ error: "Invalid object type" }, { status: 400 });
    }

    const rules = await prisma.routingRule.findMany({
      where: { orgId, objectType: objectType as "LEAD" | "CONTACT" | "ACCOUNT" },
      orderBy: { priority: "asc" },
      include: {
        conditions: { orderBy: { sortOrder: "asc" } },
        team: { select: { id: true, name: true } },
        queue: { select: { id: true, name: true } },
      },
    });

    // Enrich with assignee user name if assignmentType === USER
    const userIds = rules
      .filter((r) => r.assignmentType === "USER" && r.assigneeUserId)
      .map((r) => r.assigneeUserId!);

    const users =
      userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true },
          })
        : [];

    const userMap = new Map(users.map((u) => [u.id, u.name]));

    const result = rules.map((r) => ({
      id: r.id,
      name: r.name,
      objectType: r.objectType,
      triggerEvent: r.triggerEvent,
      priority: r.priority,
      status: r.status,
      assignmentType: r.assignmentType,
      assigneeUserId: r.assigneeUserId,
      assigneeUserName: r.assigneeUserId ? (userMap.get(r.assigneeUserId) ?? null) : null,
      assigneeTeamId: r.assigneeTeamId,
      assigneeTeamName: r.team?.name ?? null,
      assigneeQueueId: r.assigneeQueueId,
      assigneeQueueName: r.queue?.name ?? null,
      conditionCount: r.conditions.length,
      conditions: r.conditions,
      isDryRun: r.isDryRun,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return NextResponse.json({ rules: result });
  } catch (err) {
    console.error("GET /api/rules error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/rules — create a new routing rule
export async function POST(req: NextRequest) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const body = await req.json();
    const {
      name,
      objectType,
      triggerEvent,
      assignmentType,
      assigneeUserId,
      assigneeTeamId,
      assigneeQueueId,
      isDryRun = false,
      conditions = [],
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!["LEAD", "CONTACT", "ACCOUNT"].includes(objectType)) {
      return NextResponse.json({ error: "Invalid objectType" }, { status: 400 });
    }
    if (!["INSERT", "UPDATE", "BOTH"].includes(triggerEvent)) {
      return NextResponse.json({ error: "Invalid triggerEvent" }, { status: 400 });
    }
    if (!["USER", "ROUND_ROBIN", "QUEUE"].includes(assignmentType)) {
      return NextResponse.json({ error: "Invalid assignmentType" }, { status: 400 });
    }

    // Determine max priority for this object type
    const maxPriorityRule = await prisma.routingRule.findFirst({
      where: { orgId, objectType },
      orderBy: { priority: "desc" },
      select: { priority: true },
    });
    const priority = (maxPriorityRule?.priority ?? 0) + 1;

    const rule = await prisma.routingRule.create({
      data: {
        orgId,
        name: name.trim(),
        objectType,
        triggerEvent,
        priority,
        assignmentType,
        assigneeUserId: assignmentType === "USER" ? assigneeUserId : null,
        assigneeTeamId: assignmentType === "ROUND_ROBIN" ? assigneeTeamId : null,
        assigneeQueueId: assignmentType === "QUEUE" ? assigneeQueueId : null,
        isDryRun,
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
        action: "RULE_CREATED",
        entityType: "RoutingRule",
        entityId: rule.id,
        afterState: { name: rule.name, objectType, priority, assignmentType },
      },
    });

    await invalidateRulesCache(orgId, objectType);

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    console.error("POST /api/rules error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
