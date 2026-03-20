import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders, getActorFromHeaders, requireSession, requireRole } from "@/lib/auth";
import { invalidateRulesCache } from "@/lib/invalidate-rules-cache";
import { syncRoutingFlags } from "@/lib/sync-routing-flags";
import { buildMatchConfigData } from "@/app/api/rules/route";
import { SalesforceApi } from "@lead-routing/sfdc";

const SFDC_API_VERSION = "v59.0";

/**
 * Delete all Route_Criteria__c records for a given ruleId from Salesforce.
 * Fire-and-forget: errors are swallowed — a stale orphan row has no routing impact
 * (the rule is already gone from the engine cache) but cleaning up is best practice.
 */
async function deleteSfdcCriteria(orgId: string, ruleId: string): Promise<void> {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { sfdcInstanceUrl: true, oauthAccessToken: true },
    });
    if (!org?.sfdcInstanceUrl || !org.oauthAccessToken) return;

    const sfApi = new SalesforceApi(org.sfdcInstanceUrl, org.oauthAccessToken);
    const existing = await sfApi.query<{ Id: string }>(
      `SELECT Id FROM Route_Criteria__c WHERE Rule_Id__c = '${ruleId}'`
    );
    if (existing.length === 0) return;

    for (let i = 0; i < existing.length; i += 25) {
      const batch = existing.slice(i, i + 25);
      await sfApi.composite(
        batch.map((rec, idx) => ({
          method: "DELETE" as const,
          url: `/services/data/${SFDC_API_VERSION}/sobjects/Route_Criteria__c/${rec.Id}`,
          referenceId: `del_criteria_${i + idx}`,
        }))
      );
    }
  } catch {
    // Non-critical: orphaned Route_Criteria__c rows won't cause wrong routing
    // because the engine cache no longer has this rule.
  }
}

// GET /api/rules/:id — full rule detail with conditions and branches
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
        branches: {
          orderBy: { priority: "asc" },
          include: {
            conditions: { orderBy: { sortOrder: "asc" } },
            assigneeUser: { select: { id: true, name: true } },
            assigneeTeam: { select: { id: true, name: true } },
            assigneeQueue: { select: { id: true, name: true } },
          },
        },
        matchConfig: true,
        triggerConditions: { orderBy: { sortOrder: "asc" } },
        team: { select: { id: true, name: true } },
        queue: { select: { id: true, name: true } },
        defaultOwnerUser: { select: { id: true, name: true } },
        defaultOwnerTeam: { select: { id: true, name: true } },
        defaultOwnerQueue: { select: { id: true, name: true } },
      },
    });

    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    // Get assignee user name if needed (legacy rules)
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

// PUT /api/rules/:id — update rule (replaces conditions, branches, matchConfig wholesale)
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
      select: { id: true, name: true, status: true, objectType: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    const body = await req.json();
    const {
      name,
      objectType,
      triggerEvent,
      // Legacy single-assignee (optional for new-style rules)
      assignmentType,
      assigneeUserId,
      assigneeTeamId,
      assigneeQueueId,
      isDryRun,
      triggerName = "",
      triggerConditions = [],
      conditions = [],
      // Scheduled route fields
      routeType,
      scheduleFrequency,
      scheduleTime,
      scheduleTimezone,
      scheduleCron,
      searchCriteria,
      searchMaxRecords,
      searchBatchSize,
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

    const isNewStyle = branches.length > 0 || matchConfig !== null || defaultOwnerType !== null;

    // Replace conditions + branches wholesale
    await prisma.ruleCondition.deleteMany({ where: { ruleId: id } });

    // Delete existing branches (cascade deletes branch_conditions)
    await prisma.routingBranch.deleteMany({ where: { ruleId: id } });

    // Delete existing trigger conditions
    await prisma.triggerCondition.deleteMany({ where: { ruleId: id } });

    // Delete existing matchConfig
    await prisma.routeMatchConfig.deleteMany({ where: { ruleId: id } });

    const updated = await prisma.routingRule.update({
      where: { id },
      data: {
        name: name.trim(),
        objectType,
        triggerEvent,
        assignmentType: isNewStyle ? null : (assignmentType ?? null),
        assigneeUserId: (!isNewStyle && assignmentType === "USER") ? assigneeUserId : null,
        assigneeTeamId: (!isNewStyle && assignmentType === "ROUND_ROBIN") ? assigneeTeamId : null,
        assigneeQueueId: (!isNewStyle && assignmentType === "QUEUE") ? assigneeQueueId : null,
        isDryRun: isDryRun ?? false,
        routeType: routeType ?? "REALTIME",
        scheduleFrequency: scheduleFrequency ?? null,
        scheduleTime: scheduleTime ?? null,
        scheduleTimezone: scheduleTimezone ?? null,
        scheduleCron: scheduleCron ?? null,
        searchCriteria: searchCriteria ?? undefined,
        searchMaxRecords: searchMaxRecords !== undefined ? (searchMaxRecords ?? null) : undefined,
        searchBatchSize: searchBatchSize !== undefined ? (searchBatchSize ?? null) : undefined,
        triggerName: triggerName || "",
        triggerConditions: {
          create: triggerConditions.map(
            (c: any) => ({
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
          create: branches.map((b: any) => ({
            label: b.label ?? null,
            priority: b.priority,
            assignmentType: b.assignmentType,
            assigneeUserId: b.assignmentType === "USER" ? (b.assigneeUserId ?? null) : null,
            assigneeTeamId: b.assignmentType === "ROUND_ROBIN" ? (b.assigneeTeamId ?? null) : null,
            assigneeQueueId: b.assignmentType === "QUEUE" ? (b.assigneeQueueId ?? null) : null,
            steps: b.steps ?? undefined,
            // V2 branches: conditions live in steps JSON only — skip branch_conditions table
            // Legacy branches: write to branch_conditions as before
            conditions: {
              create: (b.steps && Array.isArray(b.steps) && b.steps.length > 0)
                ? []
                : (b.conditions ?? []).map((c: any, ci: number) => ({
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
              create: buildMatchConfigData(matchConfig),
            }
          : undefined,
      },
      include: {
        conditions: { orderBy: { sortOrder: "asc" } },
        branches: {
          orderBy: { priority: "asc" },
          include: { conditions: { orderBy: { sortOrder: "asc" } } },
        },
        matchConfig: true,
        triggerConditions: { orderBy: { sortOrder: "asc" } },
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
        afterState: {
          name: updated.name,
          assignmentType: updated.assignmentType,
          branchCount: branches.length,
          conditions: conditions.length,
          hasMatchConfig: matchConfig !== null,
          hasDefaultOwner: defaultOwnerType !== null,
        },
      },
    });

    await invalidateRulesCache(orgId, updated.objectType);
    syncRoutingFlags(orgId).catch(() => {});

    return NextResponse.json({ rule: updated });
  } catch (err) {
    console.error("PUT /api/rules/:id error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/rules/:id — delete rule (ADMIN only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    requireRole(session, "ADMIN");

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

    // Clean up Route_Criteria__c records from Salesforce (fire-and-forget)
    deleteSfdcCriteria(orgId, id).catch(() => {});

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
    syncRoutingFlags(orgId).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/rules/:id error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
