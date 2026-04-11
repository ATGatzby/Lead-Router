import { prisma } from "@lead-routing/db";
import type { CrmAdapter, BulkUpdateResult } from "./types.js";

/**
 * HubSpot CRM adapter.
 *
 * Note: actual HubSpot API client management stays in the engine's
 * hubspot-connection.ts — this adapter resolves IDs and provides
 * CRM metadata. CRM writes are delegated to the engine layer.
 */
export class HubSpotAdapter implements CrmAdapter {
  readonly type = "HUBSPOT" as const;

  async getCrmOwnerId(userId: string, _orgId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { crmUserId: true },
    });
    return user?.crmUserId ?? null;
  }

  async getCrmQueueId(_queueId: string, _orgId: string): Promise<string | null> {
    // HubSpot has no native queues
    return null;
  }

  async updateOwner(
    _orgId: string,
    _objectType: string,
    _recordId: string,
    _ownerId: string,
    _actionField?: string,
  ): Promise<void> {
    // Delegated to engine layer (needs HubSpot client from hubspot-connection.ts)
    throw new Error("HubSpotAdapter.updateOwner must be called via engine layer");
  }

  async updateFields(
    _orgId: string,
    _objectType: string,
    _recordId: string,
    _fields: Record<string, unknown>,
  ): Promise<void> {
    throw new Error("HubSpotAdapter.updateFields must be called via engine layer");
  }

  async batchUpdateOwners(
    _orgId: string,
    _objectType: string,
    _assignments: Array<{ recordId: string; ownerId: string }>,
  ): Promise<BulkUpdateResult> {
    throw new Error("HubSpotAdapter.batchUpdateOwners must be called via engine layer");
  }

  toCrmObjectName(objectType: string): string {
    switch (objectType) {
      case "CONTACT": return "contacts";
      case "COMPANY": return "companies";
      case "DEAL": return "deals";
      default: return objectType.toLowerCase();
    }
  }

  getSupportedObjectTypes(): string[] {
    return ["CONTACT", "COMPANY", "DEAL"];
  }

  supportsQueues(): boolean {
    return false;
  }

  supportsMerge(): boolean {
    return false;
  }
}
