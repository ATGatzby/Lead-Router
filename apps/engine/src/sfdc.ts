import { prisma } from "@lead-routing/db";
import { createConnection, type SfdcConnection } from "@lead-routing/sfdc";

// Simple in-process connection cache to avoid recreating jsforce clients on every routing event
const connCache = new Map<string, SfdcConnection>();

/**
 * Get (or create) a jsforce Connection for an org.
 * The connection handles token refresh automatically.
 */
export async function getOrgConnection(orgId: string): Promise<SfdcConnection> {
  if (connCache.has(orgId)) return connCache.get(orgId)!;

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { oauthAccessToken: true, oauthRefreshToken: true, sfdcInstanceUrl: true },
  });

  const conn = createConnection({
    accessToken: org.oauthAccessToken,
    refreshToken: org.oauthRefreshToken,
    instanceUrl: org.sfdcInstanceUrl,
  });

  connCache.set(orgId, conn);
  return conn;
}

/** Get the SFDC User ID for a given internal User.id */
export async function getSfdcUserId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sfdcUserId: true },
  });
  if (!user) throw new Error(`User ${userId} not found — may have been deleted or not synced`);
  return user.sfdcUserId;
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
