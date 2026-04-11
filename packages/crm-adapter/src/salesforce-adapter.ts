import { prisma } from "@lead-routing/db";
import type { CrmAdapter, BulkUpdateResult } from "./types.js";

/**
 * Salesforce CRM adapter.
 *
 * Note: actual jsforce connection management stays in the engine's sfdc.ts —
 * this adapter resolves IDs and delegates CRM writes to the engine layer
 * which has the cached jsforce connections.
 */
export class SalesforceAdapter implements CrmAdapter {
  readonly type = "SALESFORCE" as const;

  async getCrmOwnerId(userId: string, _orgId: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { crmUserId: true },
    });
    return user?.crmUserId ?? null;
  }

  async getCrmQueueId(queueId: string, _orgId: string): Promise<string | null> {
    const queue = await prisma.sfdcQueue.findUnique({
      where: { id: queueId },
      select: { sfdcQueueId: true },
    });
    return queue?.sfdcQueueId ?? null;
  }

  async updateOwner(
    _orgId: string,
    _objectType: string,
    _recordId: string,
    _ownerId: string,
    _actionField?: string,
  ): Promise<void> {
    // Delegated to engine layer (needs jsforce connection from sfdc.ts cache)
    throw new Error("SalesforceAdapter.updateOwner must be called via engine layer");
  }

  async updateFields(
    _orgId: string,
    _objectType: string,
    _recordId: string,
    _fields: Record<string, unknown>,
  ): Promise<void> {
    throw new Error("SalesforceAdapter.updateFields must be called via engine layer");
  }

  async batchUpdateOwners(
    _orgId: string,
    _objectType: string,
    _assignments: Array<{ recordId: string; ownerId: string }>,
  ): Promise<BulkUpdateResult> {
    throw new Error("SalesforceAdapter.batchUpdateOwners must be called via engine layer");
  }

  toCrmObjectName(objectType: string): string {
    switch (objectType) {
      case "LEAD": return "Lead";
      case "CONTACT": return "Contact";
      case "ACCOUNT": return "Account";
      default: return objectType;
    }
  }

  getSupportedObjectTypes(): string[] {
    return ["LEAD", "CONTACT", "ACCOUNT"];
  }

  supportsQueues(): boolean {
    return true;
  }

  supportsMerge(): boolean {
    return true;
  }
}
