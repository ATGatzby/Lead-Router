import type { AgentContext } from "../types";

export interface LogFilters {
  page?: number;
  limit?: number;
  fromDate?: Date;
  toDate?: Date;
  objectType?: string;
  status?: string;
  assignee?: string;
  ruleId?: string;
  teamId?: string;
}

export interface LogListResult {
  logs: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageCount: number;
}

export interface RetryResult {
  retried: number;
  skipped: number;
}

export class LogService {
  static async list(filters: LogFilters, ctx: AgentContext): Promise<LogListResult> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(200, Math.max(1, filters.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: any = { orgId: ctx.orgId };

    if (filters.fromDate || filters.toDate) {
      where.createdAt = {};
      if (filters.fromDate) where.createdAt.gte = filters.fromDate;
      if (filters.toDate) where.createdAt.lte = filters.toDate;
    }
    if (filters.objectType) where.objectType = filters.objectType;
    if (filters.status) where.status = filters.status;
    if (filters.assignee) {
      where.assigneeName = { contains: filters.assignee, mode: "insensitive" };
    }
    if (filters.ruleId) where.ruleId = filters.ruleId;
    if (filters.teamId) where.teamId = filters.teamId;

    const [total, logs] = await Promise.all([
      ctx.prisma.routingLog.count({ where }),
      ctx.prisma.routingLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return {
      logs: logs as unknown as Array<Record<string, unknown>>,
      total,
      page,
      pageCount: Math.ceil(total / limit),
    };
  }

  static async retryAll(
    filters: { fromDate?: Date; toDate?: Date; ruleId?: string; limit: number },
    ctx: AgentContext,
  ): Promise<RetryResult> {
    const where: any = {
      orgId: ctx.orgId,
      status: "FAILED",
    };

    if (filters.fromDate || filters.toDate) {
      where.createdAt = {};
      if (filters.fromDate) where.createdAt.gte = filters.fromDate;
      if (filters.toDate) where.createdAt.lte = filters.toDate;
    }
    if (filters.ruleId) where.ruleId = filters.ruleId;

    const failedLogs = await ctx.prisma.routingLog.findMany({
      where,
      take: filters.limit,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });

    if (failedLogs.length === 0) {
      return { retried: 0, skipped: 0 };
    }

    const result = await ctx.prisma.routingLog.updateMany({
      where: { id: { in: failedLogs.map((l: any) => l.id) } },
      data: { status: "RETRY" as any },
    });

    return { retried: result.count, skipped: 0 };
  }

  static async export(
    filters: {
      fromDate: Date;
      toDate: Date;
      objectType?: string;
      status?: string;
      ruleId?: string;
      limit: number;
    },
    ctx: AgentContext,
  ): Promise<Array<Record<string, unknown>>> {
    const where: any = {
      orgId: ctx.orgId,
      createdAt: { gte: filters.fromDate, lte: filters.toDate },
    };

    if (filters.objectType) where.objectType = filters.objectType;
    if (filters.status) where.status = filters.status;
    if (filters.ruleId) where.ruleId = filters.ruleId;

    const logs = await ctx.prisma.routingLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.limit,
    });

    return logs as unknown as Array<Record<string, unknown>>;
  }
}
