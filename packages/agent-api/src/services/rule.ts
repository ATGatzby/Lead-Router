import type { AgentContext } from "../types";
import { NotFoundError, ValidationError } from "../errors";

export interface CreateRuleInput {
  name: string;
  objectType: string;
  triggerEvent: string;
  assignmentType?: string | null;
  assigneeUserId?: string | null;
  assigneeTeamId?: string | null;
  assigneeQueueId?: string | null;
  isDryRun?: boolean;
  conditions?: Array<{
    groupId: string;
    fieldName: string;
    operator: string;
    value?: string | null;
    sortOrder?: number;
  }>;
}

export interface RuleSummary {
  id: string;
  name: string;
  objectType: string;
  triggerEvent: string;
  priority: number;
  status: string;
  assignmentType: string | null;
  conditionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export class RuleService {
  static async create(input: CreateRuleInput, ctx: AgentContext) {
    const maxPriorityRule = await ctx.prisma.routingRule.findFirst({
      where: { orgId: ctx.orgId, objectType: input.objectType as any },
      orderBy: { priority: "desc" },
      select: { priority: true },
    });
    const priority = (maxPriorityRule?.priority ?? 0) + 1;

    const rule = await ctx.prisma.routingRule.create({
      data: {
        orgId: ctx.orgId,
        name: input.name.trim(),
        objectType: input.objectType as any,
        triggerEvent: input.triggerEvent as any,
        priority,
        assignmentType: (input.assignmentType as any) ?? null,
        assigneeUserId: input.assignmentType === "USER" ? (input.assigneeUserId ?? null) : null,
        assigneeTeamId: input.assignmentType === "ROUND_ROBIN" ? (input.assigneeTeamId ?? null) : null,
        assigneeQueueId: input.assignmentType === "QUEUE" ? (input.assigneeQueueId ?? null) : null,
        isDryRun: input.isDryRun ?? false,
        triggerName: "",
        conditions: input.conditions
          ? {
              create: input.conditions.map((c, i) => ({
                groupId: c.groupId,
                fieldName: c.fieldName,
                operator: c.operator,
                value: c.value ?? null,
                sortOrder: c.sortOrder ?? i,
              })),
            }
          : undefined,
      },
    });

    await ctx.prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorName: ctx.actorName,
        action: "RULE_CREATED",
        entityType: "RoutingRule",
        entityId: rule.id,
        afterState: { name: rule.name, objectType: rule.objectType, priority },
      },
    });

    return rule;
  }

  static async list(ctx: AgentContext, objectType?: string): Promise<RuleSummary[]> {
    const where: any = { orgId: ctx.orgId };
    if (objectType) where.objectType = objectType;

    const rules = await ctx.prisma.routingRule.findMany({
      where,
      orderBy: { priority: "asc" },
      include: { conditions: { select: { id: true } } },
    });

    return rules.map((r: any) => ({
      id: r.id,
      name: r.name,
      objectType: r.objectType,
      triggerEvent: r.triggerEvent,
      priority: r.priority,
      status: r.status,
      assignmentType: r.assignmentType,
      conditionCount: r.conditions.length,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  static async activate(ruleId: string, ctx: AgentContext) {
    const rule = await ctx.prisma.routingRule.findFirst({
      where: { id: ruleId, orgId: ctx.orgId },
    });
    if (!rule) throw new NotFoundError("Rule", ruleId);

    return ctx.prisma.routingRule.update({
      where: { id: ruleId },
      data: { status: "ACTIVE" as any },
    });
  }

  static async deactivate(ruleId: string, ctx: AgentContext) {
    const rule = await ctx.prisma.routingRule.findFirst({
      where: { id: ruleId, orgId: ctx.orgId },
    });
    if (!rule) throw new NotFoundError("Rule", ruleId);

    return ctx.prisma.routingRule.update({
      where: { id: ruleId },
      data: { status: "INACTIVE" as any },
    });
  }

  static async reorder(objectType: string, ruleIds: string[], ctx: AgentContext) {
    const rules = await ctx.prisma.routingRule.findMany({
      where: { orgId: ctx.orgId, objectType: objectType as any, id: { in: ruleIds } },
      select: { id: true },
    });

    const existingIds = new Set(rules.map((r: any) => r.id));
    const missing = ruleIds.filter((id) => !existingIds.has(id));
    if (missing.length > 0) {
      throw new ValidationError(`Rules not found for this object type: ${missing.join(", ")}`);
    }

    const updates = ruleIds.map((id, index) =>
      ctx.prisma.routingRule.update({
        where: { id },
        data: { priority: index + 1 },
      }),
    );

    await ctx.prisma.$transaction(updates);

    return ruleIds.map((id, index) => ({ rule_id: id, priority: index + 1 }));
  }

  static async clone(ruleId: string, newName: string | undefined, ctx: AgentContext) {
    const source = await ctx.prisma.routingRule.findFirst({
      where: { id: ruleId, orgId: ctx.orgId },
      include: { conditions: true },
    });
    if (!source) throw new NotFoundError("Rule", ruleId);

    const maxPriorityRule = await ctx.prisma.routingRule.findFirst({
      where: { orgId: ctx.orgId, objectType: source.objectType },
      orderBy: { priority: "desc" },
      select: { priority: true },
    });
    const priority = (maxPriorityRule?.priority ?? 0) + 1;

    const cloned = await ctx.prisma.routingRule.create({
      data: {
        orgId: ctx.orgId,
        name: newName ?? `${source.name} (Copy)`,
        objectType: source.objectType,
        triggerEvent: source.triggerEvent,
        priority,
        status: "INACTIVE" as any,
        assignmentType: source.assignmentType,
        assigneeUserId: source.assigneeUserId,
        assigneeTeamId: source.assigneeTeamId,
        assigneeQueueId: source.assigneeQueueId,
        isDryRun: source.isDryRun,
        triggerName: source.triggerName,
        conditions: {
          create: source.conditions.map((c: any) => ({
            groupId: c.groupId,
            fieldName: c.fieldName,
            operator: c.operator,
            value: c.value,
            sortOrder: c.sortOrder,
          })),
        },
      },
    });

    await ctx.prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorName: ctx.actorName,
        action: "RULE_CLONED",
        entityType: "RoutingRule",
        entityId: cloned.id,
        afterState: { sourceId: ruleId, name: cloned.name },
      },
    });

    return cloned;
  }

  static async update(
    ruleId: string,
    data: Record<string, unknown>,
    ctx: AgentContext,
  ) {
    const rule = await ctx.prisma.routingRule.findFirst({
      where: { id: ruleId, orgId: ctx.orgId },
    });
    if (!rule) throw new NotFoundError("Rule", ruleId);

    return ctx.prisma.routingRule.update({
      where: { id: ruleId },
      data: data as any,
    });
  }

  static async updateCriteria(
    ruleId: string,
    criteria: Array<{
      field: string;
      operator: string;
      value: unknown;
    }>,
    ctx: AgentContext,
  ) {
    const rule = await ctx.prisma.routingRule.findFirst({
      where: { id: ruleId, orgId: ctx.orgId },
    });
    if (!rule) throw new NotFoundError("Rule", ruleId);

    await ctx.prisma.ruleCondition.deleteMany({ where: { ruleId } });
    await ctx.prisma.ruleCondition.createMany({
      data: criteria.map((c, i) => ({
        ruleId,
        groupId: "default",
        fieldName: c.field,
        operator: c.operator,
        value: c.value != null ? String(c.value) : null,
        sortOrder: i,
      })),
    });

    return criteria.length;
  }

  static async delete(ruleId: string, ctx: AgentContext): Promise<void> {
    const rule = await ctx.prisma.routingRule.findFirst({
      where: { id: ruleId, orgId: ctx.orgId },
    });
    if (!rule) throw new NotFoundError("Rule", ruleId);

    await ctx.prisma.ruleCondition.deleteMany({ where: { ruleId } });
    await ctx.prisma.routingRule.delete({ where: { id: ruleId } });
  }
}
