import { prisma } from "@lead-routing/db";
import { createConnection, type SfdcConnection } from "@lead-routing/sfdc";

// Simple in-process connection cache to avoid recreating jsforce clients on every routing event
const connCache = new Map<string, { conn: SfdcConnection; createdAt: number }>();

// Max age before proactive refresh (1 hour — SFDC tokens last ~2 hours)
const MAX_CONN_AGE_MS = 60 * 60 * 1000;

/**
 * Get (or create) a jsforce Connection for an org.
 * Handles token refresh automatically and persists new tokens to the DB.
 * Proactively evicts stale connections (>1 hour) to prevent INVALID_SESSION_ID errors.
 */
export async function getOrgConnection(orgId: string): Promise<SfdcConnection> {
  const cached = connCache.get(orgId);
  if (cached && Date.now() - cached.createdAt < MAX_CONN_AGE_MS) {
    return cached.conn;
  }

  // Evict stale connection — force fresh token from DB
  if (cached) {
    console.log(`[sfdc] Evicting stale connection for org ${orgId} (age: ${Math.round((Date.now() - cached.createdAt) / 60000)}m)`);
    connCache.delete(orgId);
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { oauthAccessToken: true, oauthRefreshToken: true, sfdcInstanceUrl: true },
  });

  const conn = createConnection(
    {
      accessToken: org.oauthAccessToken,
      refreshToken: org.oauthRefreshToken,
      instanceUrl: org.sfdcInstanceUrl,
    },
    // Persist refreshed access token back to DB so it survives engine restarts
    (newAccessToken: string) => {
      prisma.organization
        .update({
          where: { id: orgId },
          data: { oauthAccessToken: newAccessToken },
        })
        .then(() => console.log(`[sfdc] Persisted refreshed token for org ${orgId}`))
        .catch((err) => console.error(`[sfdc] Failed to persist refreshed token for org ${orgId}:`, err));
    }
  );

  connCache.set(orgId, { conn, createdAt: Date.now() });
  return conn;
}

/**
 * Evict a cached connection for an org.
 * Call this when authentication fails so the next request creates a fresh connection
 * with the latest tokens from the database.
 */
export function evictOrgConnection(orgId: string): void {
  connCache.delete(orgId);
  console.log(`[sfdc] Evicted connection for org ${orgId}`);
}

/** Get the CRM User/Owner ID for a given internal User.id */
export async function getSfdcUserId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmUserId: true },
  });
  if (!user) throw new Error(`User ${userId} not found — may have been deleted or not synced`);
  return user.crmUserId;
}

/** Get the SFDC Queue ID for a given internal SfdcQueue.id */
export async function getSfdcQueueId(queueId: string): Promise<string> {
  const queue = await prisma.sfdcQueue.findUnique({
    where: { id: queueId },
    select: { sfdcQueueId: true },
  });
  if (!queue) throw new Error(`Queue ${queueId} not found — may have been deleted or not synced`);
  return queue.sfdcQueueId;
}
