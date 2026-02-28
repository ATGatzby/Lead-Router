import { Redis } from "ioredis";
import { prisma } from "@lead-routing/db";

export const INVALIDATE_CHANNEL = "rules:invalidate";

// ─── Types ────────────────────────────────────────────────────────────────

export interface CachedRule {
  id: string;
  orgId: string;
  objectType: string;
  triggerEvent: string;
  name: string;
  priority: number;
  assignmentType: string;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  assigneeQueueId: string | null;
  isDryRun: boolean;
  conditions: Array<{
    groupId: string;
    fieldName: string;
    operator: string;
    value: string | null;
  }>;
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
    include: { conditions: { orderBy: { sortOrder: "asc" } } },
  });

  const cached: CachedRule[] = rules.map((r) => ({
    id: r.id,
    orgId: r.orgId,
    objectType: r.objectType,
    triggerEvent: r.triggerEvent,
    name: r.name,
    priority: r.priority,
    assignmentType: r.assignmentType,
    assigneeUserId: r.assigneeUserId,
    assigneeTeamId: r.assigneeTeamId,
    assigneeQueueId: r.assigneeQueueId,
    isDryRun: r.isDryRun,
    conditions: r.conditions.map((c) => ({
      groupId: c.groupId,
      fieldName: c.fieldName,
      operator: c.operator,
      value: c.value,
    })),
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
