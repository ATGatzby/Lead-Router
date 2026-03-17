import { Redis } from "ioredis";
import { prisma } from "@lead-routing/db";
import type { CachedFlow, CachedFlowNode, CachedFlowEdge } from "./flow-types.js";

export type { CachedFlow, CachedFlowNode, CachedFlowEdge };

export const FLOW_INVALIDATE_CHANNEL = "flows:invalidate";

// ─── In-memory store ──────────────────────────────────────────────────────

// Key: `${orgId}:${objectType}` → single active flow (only one flow per org+object)
const flowStore = new Map<string, CachedFlow>();

// Key: `${orgId}:${objectType}` → "CLASSIC" | "FLOW"
const modeStore = new Map<string, "CLASSIC" | "FLOW">();

function cacheKey(orgId: string, objectType: string): string {
  return `${orgId}:${objectType}`;
}

export function getActiveFlow(orgId: string, objectType: string): CachedFlow | null {
  return flowStore.get(cacheKey(orgId, objectType)) ?? null;
}

/**
 * Determine routing mode for a given org + object type.
 * Reads from the Organization.routingMode JSON field.
 * Falls back to "CLASSIC" if not set.
 */
export function getRoutingMode(orgId: string, objectType: string): "CLASSIC" | "FLOW" {
  return modeStore.get(cacheKey(orgId, objectType)) ?? "CLASSIC";
}

// ─── DB load ─────────────────────────────────────────────────────────────

async function loadFlowFromDB(orgId: string, objectType: string): Promise<void> {
  const key = cacheKey(orgId, objectType);

  // Load routing mode from Organization
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { routingMode: true },
  });

  if (org?.routingMode && typeof org.routingMode === "object") {
    const modeMap = org.routingMode as Record<string, string>;
    const mode = modeMap[objectType];
    if (mode === "FLOW") {
      modeStore.set(key, "FLOW");
    } else {
      modeStore.set(key, "CLASSIC");
    }
  } else {
    modeStore.set(key, "CLASSIC");
  }

  // Load active flow with nodes and edges
  const flow = await prisma.routingFlow.findFirst({
    where: {
      orgId,
      objectType: objectType as "LEAD" | "CONTACT" | "ACCOUNT",
      status: "ACTIVE",
    },
    include: {
      nodes: { orderBy: { sortOrder: "asc" } },
      edges: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!flow) {
    flowStore.delete(key);
    return;
  }

  const cached: CachedFlow = {
    id: flow.id,
    orgId: flow.orgId,
    objectType: flow.objectType,
    triggerEvent: flow.triggerEvent,
    isDryRun: flow.isDryRun,
    status: flow.status,
    nodes: flow.nodes.map((n): CachedFlowNode => ({
      id: n.id,
      type: n.type as CachedFlowNode["type"],
      label: n.label,
      config: (n.config as Record<string, unknown>) ?? null,
    })),
    edges: flow.edges.map((e): CachedFlowEdge => ({
      id: e.id,
      fromId: e.fromId,
      toId: e.toId,
      label: e.label,
    })),
  };

  flowStore.set(key, cached);
}

/** Load all active flows for all orgs+objects at startup */
export async function loadAllFlows(): Promise<void> {
  const flows = await prisma.routingFlow.findMany({
    where: { status: "ACTIVE" },
    select: { orgId: true, objectType: true },
    distinct: ["orgId", "objectType"],
  });

  await Promise.all(flows.map((f) => loadFlowFromDB(f.orgId, f.objectType)));

  // Also load routing modes for all orgs (even those without active flows)
  const orgs = await prisma.organization.findMany({
    select: { id: true, routingMode: true },
  });
  for (const org of orgs) {
    if (org.routingMode && typeof org.routingMode === "object") {
      const modeMap = org.routingMode as Record<string, string>;
      for (const [objType, mode] of Object.entries(modeMap)) {
        const key = cacheKey(org.id, objType);
        if (mode === "FLOW") {
          modeStore.set(key, "FLOW");
        } else if (!modeStore.has(key)) {
          modeStore.set(key, "CLASSIC");
        }
      }
    }
  }

  console.log(`[flow-cache] Loaded flows for ${flows.length} org+object combinations`);
}

// ─── Redis pub/sub invalidation ───────────────────────────────────────────

/**
 * Start listening for flow cache invalidation messages.
 * Requires a dedicated Redis subscriber connection.
 */
export function startFlowCacheInvalidationListener(redisUrl: string): void {
  const sub = new Redis(redisUrl, { maxRetriesPerRequest: null });

  sub.subscribe(FLOW_INVALIDATE_CHANNEL, (err) => {
    if (err) console.error("[flow-cache] Subscribe error:", err);
    else console.log(`[flow-cache] Subscribed to ${FLOW_INVALIDATE_CHANNEL}`);
  });

  sub.on("message", async (_channel: string, message: string) => {
    try {
      const { orgId, objectType } = JSON.parse(message) as {
        orgId: string;
        objectType: string;
      };
      await loadFlowFromDB(orgId, objectType);
      console.log(`[flow-cache] Reloaded flow for ${orgId}:${objectType}`);
    } catch (err) {
      console.error("[flow-cache] Failed to process invalidation message:", err);
    }
  });

  sub.on("error", (err: unknown) => {
    console.error("[flow-cache] Subscriber error:", err);
  });
}
