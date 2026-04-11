import { prisma } from "@lead-routing/db";
import { HubSpotClient, CrmApi, SearchApi, ExportApi } from "@lead-routing/hubspot";
import type { CrmObjectType } from "@lead-routing/hubspot";

// ─── Object type mapping ──────────────────────────────────────────────────

const OBJECT_TYPE_MAP: Record<string, CrmObjectType> = {
  CONTACT: "contacts",
  COMPANY: "companies",
  DEAL: "deals",
} as const;

export function toCrmObjectType(objectType: string): CrmObjectType {
  const mapped = OBJECT_TYPE_MAP[objectType];
  if (!mapped) throw new Error(`Unknown object type: ${objectType}`);
  return mapped;
}

// ─── Per-org HubSpot client cache ─────────────────────────────────────────

interface CachedClient {
  client: HubSpotClient;
  crmApi: CrmApi;
  searchApi: SearchApi;
  exportApi: ExportApi;
  createdAt: number;
}

const clientCache = new Map<string, CachedClient>();
const CLIENT_TTL_MS = 25 * 60 * 1000; // 25 minutes — tokens last 30 min

/**
 * Get (or create) a HubSpotClient + API instances for a given org.
 * Reads the org's OAuth tokens from the database and caches the client.
 */
export async function getOrgHubSpotClient(orgId: string): Promise<CachedClient> {
  const cached = clientCache.get(orgId);
  if (cached && Date.now() - cached.createdAt < CLIENT_TTL_MS) {
    return cached;
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      oauthAccessToken: true,
      oauthRefreshToken: true,
    },
  });

  if (!org?.oauthAccessToken) {
    throw new Error(`No HubSpot OAuth token for org ${orgId}`);
  }

  const client = new HubSpotClient({
    accessToken: org.oauthAccessToken,
    refreshToken: org.oauthRefreshToken ?? undefined,
    clientId: process.env.HUBSPOT_CLIENT_ID,
    clientSecret: process.env.HUBSPOT_CLIENT_SECRET,
  });

  const entry: CachedClient = {
    client,
    crmApi: new CrmApi(client),
    searchApi: new SearchApi(client),
    exportApi: new ExportApi(client),
    createdAt: Date.now(),
  };

  clientCache.set(orgId, entry);
  return entry;
}

/**
 * Evict the cached HubSpot client for an org (e.g. on auth error).
 */
export function evictOrgHubSpotClient(orgId: string): void {
  clientCache.delete(orgId);
}

/**
 * Look up a user's CRM owner ID from the database.
 * For HubSpot orgs, crmUserId stores the HubSpot owner ID.
 */
export async function getHubSpotOwnerId(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { crmUserId: true },
  });
  if (!user?.crmUserId) {
    throw new Error(`User ${userId} has no CRM owner ID configured`);
  }
  return user.crmUserId;
}

/**
 * Update a CRM record's owner via the HubSpot API.
 */
export async function updateHubSpotRecordOwner(
  orgId: string,
  objectType: string,
  recordId: string,
  ownerId: string
): Promise<void> {
  const { crmApi } = await getOrgHubSpotClient(orgId);
  await crmApi.updateObject(toCrmObjectType(objectType), recordId, {
    hubspot_owner_id: ownerId,
  });
}

/**
 * Update a CRM record's properties via the HubSpot API.
 */
export async function updateHubSpotRecordProperties(
  orgId: string,
  objectType: string,
  recordId: string,
  properties: Record<string, string>
): Promise<void> {
  const { crmApi } = await getOrgHubSpotClient(orgId);
  await crmApi.updateObject(toCrmObjectType(objectType), recordId, properties);
}
