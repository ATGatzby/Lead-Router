import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";
import { invalidateRulesCache } from "@/lib/invalidate-rules-cache";
import { syncRoutingFlags } from "@/lib/sync-routing-flags";
import { getTierLimits, upgradeRequiredResponse } from "@/lib/license";

// POST /api/rules/:id/clone — duplicate rule (appends " (Copy)" to name, sets INACTIVE, lowest priority)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    // ── License tier gating ──────────────────────────────────────────────
    const limits = getTierLimits();
    if (limits.maxRules !== Infinity) {
      const ruleCount = await prisma.routingRule.count({ where: { orgId } });
      if (ruleCount >= limits.maxRules) {
        return upgradeRequiredResponse(`Creating more than ${limits.maxRules} routing rules`);
      }
    }

    const source = await prisma.routingRule.findFirst({
      where: { id, orgId },
      include: {
        conditions: { orderBy: { sortOrder: "asc" } },
        branches: {
          orderBy: { priority: "asc" },
          include: { conditions: { orderBy: { sortOrder: "asc" } } },
        },
        matchConfig: true,
      },
    });
    if (!source) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    if (!limits.allowedTriggers.includes(source.objectType)) {
      return upgradeRequiredResponse(`${source.objectType} triggers`);
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
        status: "INACTIVE",
        assignmentType: source.assignmentType,
        assigneeUserId: source.assigneeUserId,
        assigneeTeamId: source.assigneeTeamId,
        assigneeQueueId: source.assigneeQueueId,
        isDryRun: source.isDryRun,
        defaultOwnerType: source.defaultOwnerType,
        defaultOwnerUserId: source.defaultOwnerUserId,
        defaultOwnerTeamId: source.defaultOwnerTeamId,
        defaultOwnerQueueId: source.defaultOwnerQueueId,
        conditions: {
          create: source.conditions.map((c) => ({
            groupId: c.groupId,
            fieldName: c.fieldName,
            operator: c.operator,
            value: c.value,
            sortOrder: c.sortOrder,
          })),
        },
        branches: {
          create: source.branches.map((b) => ({
            label: b.label,
            priority: b.priority,
            assignmentType: b.assignmentType,
            assigneeUserId: b.assigneeUserId,
            assigneeTeamId: b.assigneeTeamId,
            assigneeQueueId: b.assigneeQueueId,
            conditions: {
              create: b.conditions.map((c) => ({
                groupId: c.groupId,
                fieldName: c.fieldName,
                operator: c.operator,
                value: c.value,
                sortOrder: c.sortOrder,
              })),
            },
          })),
        },
        matchConfig: source.matchConfig
          ? {
              create: {
                checkLeads: source.matchConfig.checkLeads,
                checkContacts: source.matchConfig.checkContacts,
                checkAccounts: source.matchConfig.checkAccounts,
                matchEmail: source.matchConfig.matchEmail,
                matchPhone: source.matchConfig.matchPhone,
                matchDomain: source.matchConfig.matchDomain,
                matchCompanyName: source.matchConfig.matchCompanyName ?? false,
                fuzzyMatchMode: source.matchConfig.fuzzyMatchMode ?? "STRICT",
                onLeadMatch: source.matchConfig.onLeadMatch,
                leadAssignmentType: source.matchConfig.leadAssignmentType,
                leadAssigneeUserId: source.matchConfig.leadAssigneeUserId,
                leadAssigneeTeamId: source.matchConfig.leadAssigneeTeamId,
                leadAssigneeQueueId: source.matchConfig.leadAssigneeQueueId,
                onContactMatch: source.matchConfig.onContactMatch,
                contactAssignmentType: source.matchConfig.contactAssignmentType,
                contactAssigneeUserId: source.matchConfig.contactAssigneeUserId,
                contactAssigneeTeamId: source.matchConfig.contactAssigneeTeamId,
                contactAssigneeQueueId: source.matchConfig.contactAssigneeQueueId,
                onAccountMatch: source.matchConfig.onAccountMatch,
                accountAssignmentType: source.matchConfig.accountAssignmentType,
                accountAssigneeUserId: source.matchConfig.accountAssigneeUserId,
                accountAssigneeTeamId: source.matchConfig.accountAssigneeTeamId,
                accountAssigneeQueueId: source.matchConfig.accountAssigneeQueueId,
              },
            }
          : undefined,
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
    syncRoutingFlags(orgId).catch(() => {});

    return NextResponse.json({ rule: cloned }, { status: 201 });
  } catch (err) {
    console.error("POST /api/rules/:id/clone error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
