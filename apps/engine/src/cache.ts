import { Redis } from "ioredis";
import { prisma } from "@lead-routing/db";

export const INVALIDATE_CHANNEL = "rules:invalidate";

// ─── Types ────────────────────────────────────────────────────────────────

export interface CachedBranch {
  id: string;
  label: string | null;
  priority: number;
  assignmentType: string | null;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  assigneeQueueId: string | null;
  conditions: Array<{
    groupId: string;
    fieldName: string;
    operator: string;
    value: string | null;
  }>;
  steps?: Array<{
    type: "filter" | "updateField" | "createTask" | "assign";
    [key: string]: unknown;
  }>;
}

export interface CachedMatchConfig {
  checkLeads: boolean;
  checkContacts: boolean;
  checkAccounts: boolean;
  matchEmail: boolean;
  matchPhone: boolean;
  matchDomain: boolean;
  matchCompanyName: boolean;
  fuzzyMatchMode: string; // "STRICT" | "FUZZY" | "AI_SMART"
  onLeadMatch: "SFDC_MERGE" | "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM";
  leadAssignmentType: string | null;
  leadAssigneeUserId: string | null;
  leadAssigneeTeamId: string | null;
  leadAssigneeQueueId: string | null;
  onContactMatch: "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP";
  contactAssignmentType: string | null;
  contactAssigneeUserId: string | null;
  contactAssigneeTeamId: string | null;
  contactAssigneeQueueId: string | null;
  onAccountMatch: "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP";
  accountAssignmentType: string | null;
  accountAssigneeUserId: string | null;
  accountAssigneeTeamId: string | null;
  accountAssigneeQueueId: string | null;
}

export interface CachedRule {
  id: string;
  orgId: string;
  objectType: string;
  triggerEvent: string;
  name: string;
  priority: number;
  isDryRun: boolean;
  // Legacy single-assignee fields (old-style rules — null for new Route Builder rules)
  assignmentType: string | null;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  assigneeQueueId: string | null;
  // Legacy conditions (old-style rules)
  conditions: Array<{
    groupId: string;
    fieldName: string;
    operator: string;
    value: string | null;
  }>;
  // New Route Builder: branches + match config + default owner
  branches: CachedBranch[];
  matchConfig: CachedMatchConfig | null;
  defaultOwnerType: string | null;
  defaultOwnerUserId: string | null;
  defaultOwnerTeamId: string | null;
  defaultOwnerQueueId: string | null;
  // Trigger conditions (pre-filter: record must match these to enter the rule)
  triggerConditions: Array<{
    groupId: string;
    fieldName: string;
    operator: string;
    value: string | null;
  }>;
  // Scheduled route fields
  routeType: string; // "REALTIME" | "SCHEDULED"
  searchCriteria: Array<{
    id: string;
    conditions: Array<{
      fieldApiName: string;
      fieldType?: string;
      operator: string;
      value: string | null;
    }>;
  }> | null;
  scheduleFrequency: string | null;
  scheduleCron: string | null;
}

// ─── In-memory store ──────────────────────────────────────────────────────

// Key: `${orgId}:${objectType}` → rules sorted by priority ASC
const store = new Map<string, CachedRule[]>();

function cacheKey(orgId: string, objectType: string): string {
  return `${orgId}:${objectType}`;
}

export function getActiveRules(orgId: string, objectType: string): CachedRule[] {
  return store.get(cacheKey(orgId, objectType)) ?? [];
}

// ─── DB load ─────────────────────────────────────────────────────────────

async function loadRulesFromDB(orgId: string, objectType: string): Promise<void> {
  const rules = await prisma.routingRule.findMany({
    where: { orgId, objectType: objectType as "LEAD" | "CONTACT" | "ACCOUNT", status: "ACTIVE" },
    orderBy: { priority: "asc" },
    include: {
      conditions: { orderBy: { sortOrder: "asc" } },
      triggerConditions: { orderBy: { sortOrder: "asc" } },
      branches: {
        orderBy: { priority: "asc" },
        include: { conditions: { orderBy: { sortOrder: "asc" } } },
      },
      matchConfig: true,
    },
  });

  const cached: CachedRule[] = rules.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    objectType: r.objectType,
    triggerEvent: r.triggerEvent,
    name: r.name,
    priority: r.priority,
    isDryRun: r.isDryRun,
    assignmentType: r.assignmentType,
    assigneeUserId: r.assigneeUserId,
    assigneeTeamId: r.assigneeTeamId,
    assigneeQueueId: r.assigneeQueueId,
    conditions: r.conditions.map((c) => ({
      groupId: c.groupId,
      fieldName: c.fieldName,
      operator: c.operator,
      value: c.value,
    })),
    triggerConditions: r.triggerConditions.map((tc) => ({
      groupId: tc.groupId,
      fieldName: tc.fieldName,
      operator: tc.operator,
      value: tc.value,
    })),
    branches: r.branches.map((b) => ({
      id: b.id,
      label: b.label,
      priority: b.priority,
      assignmentType: b.assignmentType,
      assigneeUserId: b.assigneeUserId,
      assigneeTeamId: b.assigneeTeamId,
      assigneeQueueId: b.assigneeQueueId,
      conditions: b.conditions.map((c) => ({
        groupId: c.groupId,
        fieldName: c.fieldName,
        operator: c.operator,
        value: c.value,
      })),
      steps: (b as any).steps
        ? (Array.isArray((b as any).steps) ? (b as any).steps : JSON.parse(String((b as any).steps))) as CachedBranch["steps"]
        : undefined,
    })),
    matchConfig: r.matchConfig
      ? {
          checkLeads: r.matchConfig.checkLeads,
          checkContacts: r.matchConfig.checkContacts,
          checkAccounts: r.matchConfig.checkAccounts,
          matchEmail: r.matchConfig.matchEmail,
          matchPhone: r.matchConfig.matchPhone,
          matchDomain: r.matchConfig.matchDomain,
          matchCompanyName: r.matchConfig.matchCompanyName,
          fuzzyMatchMode: r.matchConfig.fuzzyMatchMode,
          onLeadMatch: r.matchConfig.onLeadMatch,
          leadAssignmentType: r.matchConfig.leadAssignmentType,
          leadAssigneeUserId: r.matchConfig.leadAssigneeUserId,
          leadAssigneeTeamId: r.matchConfig.leadAssigneeTeamId,
          leadAssigneeQueueId: r.matchConfig.leadAssigneeQueueId,
          onContactMatch: r.matchConfig.onContactMatch,
          contactAssignmentType: r.matchConfig.contactAssignmentType,
          contactAssigneeUserId: r.matchConfig.contactAssigneeUserId,
          contactAssigneeTeamId: r.matchConfig.contactAssigneeTeamId,
          contactAssigneeQueueId: r.matchConfig.contactAssigneeQueueId,
          onAccountMatch: r.matchConfig.onAccountMatch,
          accountAssignmentType: r.matchConfig.accountAssignmentType,
          accountAssigneeUserId: r.matchConfig.accountAssigneeUserId,
          accountAssigneeTeamId: r.matchConfig.accountAssigneeTeamId,
          accountAssigneeQueueId: r.matchConfig.accountAssigneeQueueId,
        }
      : null,
    defaultOwnerType: r.defaultOwnerType,
    defaultOwnerUserId: r.defaultOwnerUserId,
    defaultOwnerTeamId: r.defaultOwnerTeamId,
    defaultOwnerQueueId: r.defaultOwnerQueueId,
    routeType: (r as any).routeType ?? "REALTIME",
    searchCriteria: (r as any).searchCriteria as CachedRule["searchCriteria"],
    scheduleFrequency: (r as any).scheduleFrequency ?? null,
    scheduleCron: (r as any).scheduleCron ?? null,
  }));

  store.set(cacheKey(orgId, objectType), cached);
}

/** Load all active rules for all orgs+objects at startup */
export async function loadAllRules(): Promise<void> {
  const rules = await prisma.routingRule.findMany({
    where: { status: "ACTIVE" },
    select: { orgId: true, objectType: true },
    distinct: ["orgId", "objectType"],
  });

  await Promise.all(rules.map((r) => loadRulesFromDB(r.orgId, r.objectType)));
  console.log(`[cache] Loaded rules for ${rules.length} org+object combinations`);
}

// ─── Redis pub/sub invalidation ───────────────────────────────────────────

/**
 * Start listening for cache invalidation messages.
 * Requires a dedicated Redis subscriber connection (can't reuse command connection).
 */
export function startCacheInvalidationListener(redisUrl: string): void {
  const sub = new Redis(redisUrl, { maxRetriesPerRequest: null });

  sub.subscribe(INVALIDATE_CHANNEL, (err) => {
    if (err) console.error("[cache] Subscribe error:", err);
    else console.log(`[cache] Subscribed to ${INVALIDATE_CHANNEL}`);
  });

  sub.on("message", async (_channel: string, message: string) => {
    try {
      const { orgId, objectType } = JSON.parse(message) as {
        orgId: string;
        objectType: string;
      };
      await loadRulesFromDB(orgId, objectType);
      console.log(`[cache] Reloaded rules for ${orgId}:${objectType}`);
    } catch (err) {
      console.error("[cache] Failed to process invalidation message:", err);
    }
  });

  sub.on("error", (err: unknown) => {
    console.error("[cache] Subscriber error:", err);
  });
}
