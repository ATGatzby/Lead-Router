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
  filters: DateRange & { status?: string; ruleId?: string; assigneeId?: string; assigneeName?: string; objectType?: string; pathLabel?: string; branchId?: string; limit?: number }
) {
  return prisma.routingLog.findMany({
    where: {
      orgId,
      ...(filters.status && { status: filters.status as any }),
      ...(filters.ruleId && { ruleId: filters.ruleId }),
      ...(filters.assigneeId && { assigneeId: filters.assigneeId }),
      ...(filters.assigneeName && { assigneeName: { contains: filters.assigneeName, mode: "insensitive" as const } }),
      ...(filters.objectType && { objectType: filters.objectType as any }),
      ...(filters.pathLabel && { pathLabel: filters.pathLabel }),
      ...(filters.branchId && { branchId: filters.branchId }),
      ...(dateFilter(filters) && { createdAt: dateFilter(filters) }),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 50,
    select: {
      id: true,
      crmRecordId: true,
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

export async function getBranchPerformance(orgId: string, filters: DateRange & { ruleId: string }) {
  const logs = await prisma.routingLog.groupBy({
    by: ["branchId", "pathLabel", "status"],
    where: {
      orgId,
      ruleId: filters.ruleId,
      ...(dateFilter(filters) && { createdAt: dateFilter(filters) }),
    },
    _count: { id: true },
    _avg: { routingDurationMs: true },
  });

  // Pivot into per-branch summary
  const branches = new Map<string, { branchId: string | null; pathLabel: string | null; success: number; failed: number; unmatched: number; merged: number; total: number; avgDurationMs: number | null }>();
  for (const row of logs) {
    const key = row.branchId ?? row.pathLabel ?? "default";
    const existing = branches.get(key) ?? { branchId: row.branchId, pathLabel: row.pathLabel, success: 0, failed: 0, unmatched: 0, merged: 0, total: 0, avgDurationMs: null };
    const count = row._count.id;
    existing.total += count;
    if (row.status === "SUCCESS") existing.success += count;
    else if (row.status === "FAILED") existing.failed += count;
    else if (row.status === "UNMATCHED") existing.unmatched += count;
    else if (row.status === "MERGED") existing.merged += count;
    if (row._avg.routingDurationMs) existing.avgDurationMs = row._avg.routingDurationMs;
    branches.set(key, existing);
  }
  return Array.from(branches.values()).sort((a, b) => b.total - a.total);
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

export async function getRoutingTimeline(orgId: string, crmRecordId: string) {
  return prisma.routingLog.findMany({
    where: { orgId, crmRecordId },
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

// ─── New: Full database coverage ──────────────────────────────────────────────

export async function listTeams(orgId: string, filters: { teamId?: string }) {
  return prisma.roundRobinTeam.findMany({
    where: {
      orgId,
      ...(filters.teamId && { id: filters.teamId }),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      pointerIndex: true,
      createdAt: true,
      updatedAt: true,
      members: {
        select: {
          id: true,
          status: true,
          weight: true,
          assignmentCount: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              crmUserId: true,
              isActive: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function listUsers(
  orgId: string,
  filters: { isLicensed?: boolean; isActive?: boolean; department?: string; search?: string; limit?: number }
) {
  return prisma.user.findMany({
    where: {
      orgId,
      ...(filters.isLicensed !== undefined && { isLicensed: filters.isLicensed }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
      ...(filters.department && { department: filters.department }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: "insensitive" as const } },
          { email: { contains: filters.search, mode: "insensitive" as const } },
        ],
      }),
    },
    orderBy: { name: "asc" },
    take: filters.limit ?? 100,
    select: {
      id: true,
      crmUserId: true,
      name: true,
      email: true,
      role: true,
      profile: true,
      department: true,
      isLicensed: true,
      isActive: true,
      lastRoutedAt: true,
      syncedAt: true,
      createdAt: true,
    },
  });
}

export async function queryAuditLogs(
  orgId: string,
  filters: DateRange & { action?: string; entityType?: string; entityId?: string; actorId?: string; limit?: number }
) {
  return prisma.auditLog.findMany({
    where: {
      orgId,
      ...(filters.action && { action: filters.action }),
      ...(filters.entityType && { entityType: filters.entityType }),
      ...(filters.entityId && { entityId: filters.entityId }),
      ...(filters.actorId && { actorId: filters.actorId }),
      ...(dateFilter(filters) && { createdAt: dateFilter(filters) }),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 50,
    select: {
      id: true,
      actorId: true,
      actorName: true,
      action: true,
      entityType: true,
      entityId: true,
      beforeState: true,
      afterState: true,
      createdAt: true,
    },
  });
}

export async function listQueues(orgId: string) {
  return prisma.sfdcQueue.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      sfdcQueueId: true,
      name: true,
      syncedAt: true,
    },
  });
}

export async function queryCompanyAliases(
  orgId: string,
  filters: { name?: string; isSimilar?: boolean; source?: string; limit?: number }
) {
  return prisma.companyAlias.findMany({
    where: {
      orgId,
      ...(filters.isSimilar !== undefined && { isSimilar: filters.isSimilar }),
      ...(filters.source && { source: filters.source }),
      ...(filters.name && {
        OR: [
          { nameA: { contains: filters.name, mode: "insensitive" as const } },
          { nameB: { contains: filters.name, mode: "insensitive" as const } },
        ],
      }),
    },
    orderBy: { hitCount: "desc" },
    take: filters.limit ?? 50,
    select: {
      id: true,
      nameA: true,
      nameB: true,
      isSimilar: true,
      confidence: true,
      source: true,
      hitCount: true,
      createdAt: true,
    },
  });
}

export async function listFields(orgId: string, filters: { objectType?: string }) {
  return prisma.fieldSchema.findMany({
    where: {
      orgId,
      ...(filters.objectType && { objectType: filters.objectType as any }),
    },
    orderBy: [{ objectType: "asc" }, { fieldLabel: "asc" }],
    select: {
      id: true,
      objectType: true,
      fieldApiName: true,
      fieldLabel: true,
      fieldType: true,
      picklistValues: true,
      syncedAt: true,
    },
  });
}

export async function getOrgSettings(orgId: string) {
  return prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: {
      id: true,
      sfdcOrgId: true,
      sfdcInstanceUrl: true,
      // Intentionally omit: oauthAccessToken, oauthRefreshToken, webhookSecret, aiApiKey
      packageDeployedAt: true,
      packageDeployId: true,
      packageVersion: true,
      objectConfig: true,
      fieldsSyncedAt: true,
      plan: true,
      isActive: true,
      seatsPurchased: true,
      seatsUsed: true,
      routingQuotaUsed: true,
      quotaResetAt: true,
      onboardingDone: true,
      notificationWebhookUrl: true,
      aiProvider: true,
      aiModelName: true,
      aiBaseUrl: true,
      aiChatCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function listAppUsers(orgId: string, filters: { role?: string; isActive?: boolean }) {
  return prisma.appUser.findMany({
    where: {
      orgId,
      ...(filters.role && { role: filters.role }),
      ...(filters.isActive !== undefined && { isActive: filters.isActive }),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      // Intentionally omit: passwordHash
    },
  });
}

export async function listInvites(orgId: string, filters: { status?: string }) {
  const now = new Date();
  const where: any = { orgId };

  if (filters.status === "pending") {
    where.acceptedAt = null;
    where.expiresAt = { gt: now };
  } else if (filters.status === "accepted") {
    where.acceptedAt = { not: null };
  } else if (filters.status === "expired") {
    where.acceptedAt = null;
    where.expiresAt = { lte: now };
  }

  return prisma.invite.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      // Intentionally omit: token
      expiresAt: true,
      acceptedAt: true,
      createdAt: true,
    },
  });
}

export async function getBillingInfo(orgId: string) {
  return prisma.billingInfo.findUnique({
    where: { orgId },
    select: {
      id: true,
      entityName: true,
      gstin: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      state: true,
      pinCode: true,
      invoiceEmail: true,
      updatedAt: true,
    },
  });
}

export async function listSessions(orgId: string, filters: { activeOnly?: boolean }) {
  const where: any = { orgId };
  if (filters.activeOnly !== false) {
    where.expiresAt = { gt: new Date() };
  }

  return prisma.session.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      // Intentionally omit: id (session token)
      orgId: true,
      userId: true,
      userName: true,
      userEmail: true,
      expiresAt: true,
      createdAt: true,
    },
  });
}
