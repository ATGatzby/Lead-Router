import { prisma } from "@lead-routing/db";

interface DateRange {
  dateFrom?: string; // ISO date
  dateTo?: string;   // ISO date
}

function dateFilter(range: DateRange) {
  const filter: Record<string, Date> = {};
  if (range.dateFrom) filter.gte = new Date(range.dateFrom);
  if (range.dateTo) filter.lte = new Date(range.dateTo);
  return Object.keys(filter).length ? filter : undefined;
}

export async function queryRoutingLogs(
  orgId: string,
  filters: DateRange & { status?: string; ruleId?: string; assigneeId?: string; objectType?: string; limit?: number }
) {
  return prisma.routingLog.findMany({
    where: {
      orgId,
      ...(filters.status && { status: filters.status as any }),
      ...(filters.ruleId && { ruleId: filters.ruleId }),
      ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
      ...(filters.objectType && { objectType: filters.objectType as any }),
      ...(dateFilter(filters) && { createdAt: dateFilter(filters) }),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 50,
    select: {
      id: true,
      sfdcRecordId: true,
      objectType: true,
      eventType: true,
      ruleName: true,
      pathLabel: true,
      assigneeId: true,
      assigneeName: true,
      assignmentType: true,
      status: true,
      errorMessage: true,
      routingDurationMs: true,
      teamName: true,
      isDryRun: true,
      createdAt: true,
    },
  });
}

export async function getRulePerformance(orgId: string, range: DateRange) {
  const logs = await prisma.routingLog.groupBy({
    by: ["ruleId", "ruleName", "status"],
    where: {
      orgId,
      ...(dateFilter(range) && { createdAt: dateFilter(range) }),
    },
    _count: { id: true },
    _avg: { routingDurationMs: true },
  });

  // Pivot into per-rule summary
  const rules = new Map<string, { ruleId: string; ruleName: string; success: number; failed: number; unmatched: number; merged: number; total: number; avgDurationMs: number | null }>();
  for (const row of logs) {
    const key = row.ruleId ?? "unmatched";
    const existing = rules.get(key) ?? { ruleId: key, ruleName: row.ruleName ?? "Unmatched", success: 0, failed: 0, unmatched: 0, merged: 0, total: 0, avgDurationMs: null };
    const count = row._count.id;
    existing.total += count;
    if (row.status === "SUCCESS") existing.success += count;
    else if (row.status === "FAILED") existing.failed += count;
    else if (row.status === "UNMATCHED") existing.unmatched += count;
    else if (row.status === "MERGED") existing.merged += count;
    if (row._avg.routingDurationMs) existing.avgDurationMs = row._avg.routingDurationMs;
    rules.set(key, existing);
  }
  return Array.from(rules.values()).sort((a, b) => b.total - a.total);
}

export async function getTeamWorkload(orgId: string, range: DateRange) {
  const logs = await prisma.routingLog.groupBy({
    by: ["teamId", "teamName", "assigneeId", "assigneeName"],
    where: {
      orgId,
      status: "SUCCESS",
      teamId: { not: null },
      ...(dateFilter(range) && { createdAt: dateFilter(range) }),
    },
    _count: { id: true },
  });
  return logs.map((row) => ({
    teamId: row.teamId,
    teamName: row.teamName,
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    assignmentCount: row._count.id,
  })).sort((a, b) => b.assignmentCount - a.assignmentCount);
}

export async function getConversionMetrics(orgId: string, range: DateRange) {
  const conversions = await prisma.conversionTracking.findMany({
    where: {
      orgId,
      ...(dateFilter(range) && { createdAt: dateFilter(range) }),
    },
    select: {
      ruleId: true,
      ruleName: true,
      pathLabel: true,
      assigneeId: true,
      assigneeName: true,
      teamId: true,
      isConverted: true,
      opportunityAmount: true,
      opportunityStageName: true,
    },
  });

  const byRule = new Map<string, { ruleName: string; total: number; converted: number; totalPipeline: number }>();
  for (const c of conversions) {
    const key = c.ruleId ?? "unknown";
    const existing = byRule.get(key) ?? { ruleName: c.ruleName ?? "Unknown", total: 0, converted: 0, totalPipeline: 0 };
    existing.total++;
    if (c.isConverted) {
      existing.converted++;
      existing.totalPipeline += c.opportunityAmount ?? 0;
    }
    byRule.set(key, existing);
  }
  return Array.from(byRule.entries()).map(([ruleId, data]) => ({
    ruleId,
    ...data,
    conversionRate: data.total > 0 ? data.converted / data.total : 0,
  })).sort((a, b) => b.totalPipeline - a.totalPipeline);
}

export async function getTrendData(orgId: string, filters: DateRange & { ruleId?: string }) {
  return prisma.routingDailyAggregate.findMany({
    where: {
      orgId,
      ...(filters.ruleId && { ruleId: filters.ruleId }),
      ...(dateFilter(filters) && { date: dateFilter(filters) }),
    },
    orderBy: { date: "asc" },
    select: {
      date: true,
      ruleId: true,
      pathLabel: true,
      successCount: true,
      failedCount: true,
      unmatchedCount: true,
      mergedCount: true,
      totalCount: true,
      avgDurationMs: true,
    },
  });
}

export async function listRules(orgId: string, filters: { status?: string; objectType?: string }) {
  return prisma.routingRule.findMany({
    where: {
      orgId,
      ...(filters.status && { status: filters.status as any }),
      ...(filters.objectType && { objectType: filters.objectType as any }),
    },
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      objectType: true,
      triggerEvent: true,
      status: true,
      priority: true,
      isDryRun: true,
      assignmentType: true,
      defaultOwnerType: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { branches: true, conditions: true } },
    },
  });
}

export async function getAssigneeStats(orgId: string, range: DateRange) {
  const logs = await prisma.routingLog.groupBy({
    by: ["assigneeId", "assigneeName"],
    where: {
      orgId,
      status: "SUCCESS",
      assigneeId: { not: null },
      ...(dateFilter(range) && { createdAt: dateFilter(range) }),
    },
    _count: { id: true },
  });
  return logs.map((row) => ({
    assigneeId: row.assigneeId,
    assigneeName: row.assigneeName,
    assignmentCount: row._count.id,
  })).sort((a, b) => b.assignmentCount - a.assignmentCount);
}

export async function explainRule(orgId: string, ruleId: string) {
  return prisma.routingRule.findFirst({
    where: { id: ruleId, orgId },
    include: {
      branches: {
        include: { conditions: true },
        orderBy: { priority: "asc" },
      },
      conditions: true,
      matchConfig: true,
      triggerConditions: true,
    },
  });
}

export async function getRoutingTimeline(orgId: string, sfdcRecordId: string) {
  return prisma.routingLog.findMany({
    where: { orgId, sfdcRecordId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      objectType: true,
      eventType: true,
      ruleName: true,
      pathLabel: true,
      assigneeName: true,
      status: true,
      errorMessage: true,
      routingDurationMs: true,
      createdAt: true,
    },
  });
}
