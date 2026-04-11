import { prisma } from "@lead-routing/db";
import { SalesforceAdapter } from "./salesforce-adapter.js";
import { HubSpotAdapter } from "./hubspot-adapter.js";
import type { CrmAdapter } from "./types.js";

const cache = new Map<string, CrmAdapter>();

/**
 * Get the CRM adapter for an org. Caches by orgId.
 * Defaults to Salesforce if crmType is not set.
 */
export async function getCrmAdapter(orgId: string): Promise<CrmAdapter> {
  if (cache.has(orgId)) return cache.get(orgId)!;

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { crmType: true },
  });

  const adapter =
    org.crmType === "HUBSPOT"
      ? new HubSpotAdapter()
      : new SalesforceAdapter();

  cache.set(orgId, adapter);
  return adapter;
}

/** Evict cached adapter (e.g. when org disconnects CRM) */
export function evictCrmAdapter(orgId: string): void {
  cache.delete(orgId);
}
