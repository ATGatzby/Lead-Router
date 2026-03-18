import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders, getActorFromHeaders } from "@/lib/auth";
import { invalidateRulesCache } from "@/lib/invalidate-rules-cache";
import { syncRoutingFlags } from "@/lib/sync-routing-flags";
import { getTierLimits, upgradeRequiredResponse } from "@/lib/license";

// ─── Types ────────────────────────────────────────────────────────────────

interface BranchInput {
  id?: string;
  label?: string;
  priority: number;
  assignmentType: "USER" | "ROUND_ROBIN" | "QUEUE";
  assigneeUserId?: string | null;
  assigneeTeamId?: string | null;
  assigneeQueueId?: string | null;
  steps?: any;
  conditions: Array<{
    groupId: string;
    fieldName: string;
    fieldType?: string;
    operator: string;
    value?: string | null;
    sortOrder?: number;
  }>;
}

interface MatchConfigInput {
  checkLeads: boolean;
  checkContacts: boolean;
  checkAccounts: boolean;
  matchEmail: boolean;
  matchPhone: boolean;
  matchDomain: boolean;
  matchCompanyName?: boolean;
  fuzzyMatchMode?: "STRICT" | "FUZZY" | "AI_SMART";
  onLeadMatch: "SFDC_MERGE" | "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM";
  leadAssignmentType?: "USER" | "ROUND_ROBIN" | "QUEUE" | null;
  leadAssigneeUserId?: string | null;
  leadAssigneeTeamId?: string | null;
  leadAssigneeQueueId?: string | null;
  onContactMatch: "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP";
  contactAssignmentType?: "USER" | "ROUND_ROBIN" | "QUEUE" | null;
  contactAssigneeUserId?: string | null;
  contactAssigneeTeamId?: string | null;
  contactAssigneeQueueId?: string | null;
  onAccountMatch: "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP";
  accountAssignmentType?: "USER" | "ROUND_ROBIN" | "QUEUE" | null;
  accountAssigneeUserId?: string | null;
  accountAssigneeTeamId?: string | null;
  accountAssigneeQueueId?: string | null;
}

// GET /api/rules?object=LEAD — list rules for object, ordered by priority
// When no `object` param is provided, returns ALL rules across all object types.
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const objectParam = req.nextUrl.searchParams.get("object")?.toUpperCase() ?? null;

    if (objectParam && !["LEAD", "CONTACT", "ACCOUNT"].includes(objectParam)) {
      return NextResponse.json({ error: "Invalid object type" }, { status: 400 });
    }

    const where: { orgId: string; objectType?: "LEAD" | "CONTACT" | "ACCOUNT" } = { orgId };
    if (objectParam) {
      where.objectType = objectParam as "LEAD" | "CONTACT" | "ACCOUNT";
    }

    const rules = await prisma.routingRule.findMany({
      where,
      orderBy: { priority: "asc" },
      include: {
        conditions: { orderBy: { sortOrder: "asc" } },
        branches: {
          orderBy: { priority: "asc" },
          include: { conditions: { orderBy: { sortOrder: "asc" } } },
        },
        matchConfig: true,
        triggerConditions: { orderBy: { sortOrder: "asc" } },
        team: { select: { id: true, name: true } },
        queue: { select: { id: true, name: true } },
        bulkSearchRuns: {
          where: { status: "RUNNING" },
          orderBy: { startedAt: "desc" },
          take: 1,
          select: {
            id: true,
            status: true,
            recordsFound: true,
            recordsProcessed: true,
            recordsRouted: true,
            recordsFailed: true,
          },
        },
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
      branches: r.branches,
      matchConfig: r.matchConfig,
      defaultOwnerType: r.defaultOwnerType,
      defaultOwnerUserId: r.defaultOwnerUserId,
      defaultOwnerTeamId: r.defaultOwnerTeamId,
      defaultOwnerQueueId: r.defaultOwnerQueueId,
      isDryRun: r.isDryRun,
      triggerName: r.triggerName,
      triggerConditions: r.triggerConditions,
      routeType: (r as any).routeType ?? "REALTIME",
      scheduleFrequency: (r as any).scheduleFrequency ?? null,
      scheduleTime: (r as any).scheduleTime ?? null,
      scheduleTimezone: (r as any).scheduleTimezone ?? null,
      searchCriteria: (r as any).searchCriteria ?? null,
      lastRunAt: (r as any).lastRunAt ?? null,
      lastRunStatus: (r as any).lastRunStatus ?? null,
      lastRunRecords: (r as any).lastRunRecords ?? null,
      lastRunDurationMs: (r as any).lastRunDurationMs ?? null,
      totalRuns: (r as any).totalRuns ?? 0,
      totalRecordsRouted: (r as any).totalRecordsRouted ?? 0,
      activeBulkRun: r.bulkSearchRuns[0] ?? null,
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
      // Legacy single-assignee fields (optional for new-style Route Builder rules)
      assignmentType,
      assigneeUserId,
      assigneeTeamId,
      assigneeQueueId,
      isDryRun = false,
      triggerName = "",
      triggerConditions = [],
      conditions = [],
      // Scheduled route fields
      routeType = "REALTIME",
      scheduleFrequency = null,
      scheduleTime = null,
      scheduleTimezone = null,
      scheduleCron = null,
      searchCriteria = undefined,
      searchMaxRecords = undefined,
      searchBatchSize = undefined,
      // New Route Builder fields
      branches = [],
      matchConfig = null,
      defaultOwnerType = null,
      defaultOwnerUserId = null,
      defaultOwnerTeamId = null,
      defaultOwnerQueueId = null,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (!["LEAD", "CONTACT", "ACCOUNT"].includes(objectType)) {
      return NextResponse.json({ error: "Invalid objectType" }, { status: 400 });
    }

    // ── License tier gating ──────────────────────────────────────────────
    const limits = getTierLimits();
    if (limits.maxRules !== Infinity) {
      const ruleCount = await prisma.routingRule.count({ where: { orgId } });
      if (ruleCount >= limits.maxRules) {
        return upgradeRequiredResponse(`Creating more than ${limits.maxRules} routing rules`);
      }
    }
    if (!limits.allowedTriggers.includes(objectType)) {
      return upgradeRequiredResponse(`${objectType} triggers`);
    }
    if (!["INSERT", "UPDATE", "BOTH", "SEARCH"].includes(triggerEvent)) {
      return NextResponse.json({ error: "Invalid triggerEvent" }, { status: 400 });
    }

    // For legacy rules, assignmentType is required
    const isNewStyle = branches.length > 0 || matchConfig !== null || defaultOwnerType !== null;
    if (!isNewStyle && !["USER", "ROUND_ROBIN", "QUEUE"].includes(assignmentType)) {
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
        assignmentType: isNewStyle ? null : assignmentType,
        assigneeUserId: (!isNewStyle && assignmentType === "USER") ? assigneeUserId : null,
        assigneeTeamId: (!isNewStyle && assignmentType === "ROUND_ROBIN") ? assigneeTeamId : null,
        assigneeQueueId: (!isNewStyle && assignmentType === "QUEUE") ? assigneeQueueId : null,
        isDryRun,
        routeType: routeType ?? "REALTIME",
        scheduleFrequency: scheduleFrequency ?? null,
        scheduleTime: scheduleTime ?? null,
        scheduleTimezone: scheduleTimezone ?? null,
        scheduleCron: scheduleCron ?? null,
        searchCriteria: searchCriteria ?? undefined,
        searchMaxRecords: searchMaxRecords !== undefined ? (searchMaxRecords ?? null) : null,
        searchBatchSize: searchBatchSize !== undefined ? (searchBatchSize ?? null) : null,
        triggerName: triggerName || "",
        triggerConditions: {
          create: triggerConditions.map(
            (c: { groupId: string; fieldName: string; fieldType?: string; operator: string; value?: string | null; sortOrder?: number }) => ({
              groupId: c.groupId,
              fieldName: c.fieldName,
              fieldType: c.fieldType ?? "TEXT",
              operator: c.operator,
              value: c.value ?? null,
              sortOrder: c.sortOrder ?? 0,
            })
          ),
        },
        defaultOwnerType: defaultOwnerType ?? null,
        defaultOwnerUserId: defaultOwnerType === "USER" ? defaultOwnerUserId : null,
        defaultOwnerTeamId: defaultOwnerType === "ROUND_ROBIN" ? defaultOwnerTeamId : null,
        defaultOwnerQueueId: defaultOwnerType === "QUEUE" ? defaultOwnerQueueId : null,
        conditions: {
          create: conditions.map(
            (c: { groupId: string; fieldName: string; operator: string; value?: string | null; sortOrder?: number }) => ({
              groupId: c.groupId,
              fieldName: c.fieldName,
              operator: c.operator,
              value: c.value ?? null,
              sortOrder: c.sortOrder ?? 0,
            })
          ),
        },
        branches: {
          create: (branches as BranchInput[]).map((b) => ({
            label: b.label ?? null,
            priority: b.priority,
            assignmentType: b.assignmentType,
            assigneeUserId: b.assignmentType === "USER" ? (b.assigneeUserId ?? null) : null,
            assigneeTeamId: b.assignmentType === "ROUND_ROBIN" ? (b.assigneeTeamId ?? null) : null,
            assigneeQueueId: b.assignmentType === "QUEUE" ? (b.assigneeQueueId ?? null) : null,
            steps: b.steps ?? undefined,
            // V2 branches: conditions live in steps JSON only — skip branch_conditions table
            conditions: {
              create: (b.steps && Array.isArray(b.steps) && b.steps.length > 0)
                ? []
                : b.conditions.map((c, ci) => ({
                    groupId: c.groupId,
                    fieldName: c.fieldName,
                    fieldType: c.fieldType ?? "TEXT",
                    operator: c.operator,
                    value: c.value ?? null,
                    sortOrder: c.sortOrder ?? ci,
                  })),
            },
          })),
        },
        matchConfig: matchConfig
          ? {
              create: buildMatchConfigData(matchConfig as MatchConfigInput),
            }
          : undefined,
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
        afterState: { name: rule.name, objectType, priority, assignmentType: rule.assignmentType },
      },
    });

    await invalidateRulesCache(orgId, objectType);
    syncRoutingFlags(orgId).catch(() => {});

    return NextResponse.json({ rule }, { status: 201 });
  } catch (err) {
    console.error("POST /api/rules error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────

export function buildMatchConfigData(mc: MatchConfigInput) {
  return {
    checkLeads: mc.checkLeads,
    checkContacts: mc.checkContacts,
    checkAccounts: mc.checkAccounts,
    matchEmail: mc.matchEmail,
    matchPhone: mc.matchPhone,
    matchDomain: mc.matchDomain,
    matchCompanyName: mc.matchCompanyName ?? false,
    fuzzyMatchMode: mc.fuzzyMatchMode ?? "STRICT",
    onLeadMatch: mc.onLeadMatch,
    leadAssignmentType: mc.leadAssignmentType ?? null,
    leadAssigneeUserId: mc.onLeadMatch === "ASSIGN_CUSTOM" && mc.leadAssignmentType === "USER" ? (mc.leadAssigneeUserId ?? null) : null,
    leadAssigneeTeamId: mc.onLeadMatch === "ASSIGN_CUSTOM" && mc.leadAssignmentType === "ROUND_ROBIN" ? (mc.leadAssigneeTeamId ?? null) : null,
    leadAssigneeQueueId: mc.onLeadMatch === "ASSIGN_CUSTOM" && mc.leadAssignmentType === "QUEUE" ? (mc.leadAssigneeQueueId ?? null) : null,
    onContactMatch: mc.onContactMatch,
    contactAssignmentType: mc.contactAssignmentType ?? null,
    contactAssigneeUserId: mc.onContactMatch === "ASSIGN_CUSTOM" && mc.contactAssignmentType === "USER" ? (mc.contactAssigneeUserId ?? null) : null,
    contactAssigneeTeamId: mc.onContactMatch === "ASSIGN_CUSTOM" && mc.contactAssignmentType === "ROUND_ROBIN" ? (mc.contactAssigneeTeamId ?? null) : null,
    contactAssigneeQueueId: mc.onContactMatch === "ASSIGN_CUSTOM" && mc.contactAssignmentType === "QUEUE" ? (mc.contactAssigneeQueueId ?? null) : null,
    onAccountMatch: mc.onAccountMatch,
    accountAssignmentType: mc.accountAssignmentType ?? null,
    accountAssigneeUserId: mc.onAccountMatch === "ASSIGN_CUSTOM" && mc.accountAssignmentType === "USER" ? (mc.accountAssigneeUserId ?? null) : null,
    accountAssigneeTeamId: mc.onAccountMatch === "ASSIGN_CUSTOM" && mc.accountAssignmentType === "ROUND_ROBIN" ? (mc.accountAssigneeTeamId ?? null) : null,
    accountAssigneeQueueId: mc.onAccountMatch === "ASSIGN_CUSTOM" && mc.accountAssignmentType === "QUEUE" ? (mc.accountAssigneeQueueId ?? null) : null,
  };
}
