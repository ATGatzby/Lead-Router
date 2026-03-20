import { prisma } from "@lead-routing/db";
import { SalesforceApi } from "@lead-routing/sfdc";

const OBJECT_TYPES = ["LEAD", "CONTACT", "ACCOUNT"] as const;

/**
 * Sync Salesforce routing flags based on active rules for an org.
 * Computes which object types / trigger events have active rules and
 * writes the corresponding boolean flags to lrt__Routing_Settings__c.
 * Fails silently — this is fire-and-forget.
 */
export async function syncRoutingFlags(orgId: string): Promise<void> {
  try {
    const rules = await prisma.routingRule.findMany({
      where: { orgId, status: "ACTIVE" },
      select: { objectType: true, triggerEvent: true },
    });

    const flags: Record<string, boolean> = {};

    for (const obj of OBJECT_TYPES) {
      const objRules = rules.filter((r) => r.objectType === obj);
      const hasInsert = objRules.some(
        (r) => r.triggerEvent === "INSERT" || r.triggerEvent === "BOTH"
      );
      const hasUpdate = objRules.some(
        (r) => r.triggerEvent === "UPDATE" || r.triggerEvent === "BOTH"
      );

      flags[`lrt__${obj.charAt(0)}${obj.slice(1).toLowerCase()}_Routing_Enabled__c`] =
        hasInsert || hasUpdate;
      flags[`lrt__${obj.charAt(0)}${obj.slice(1).toLowerCase()}_Insert_Enabled__c`] =
        hasInsert;
      flags[`lrt__${obj.charAt(0)}${obj.slice(1).toLowerCase()}_Update_Enabled__c`] =
        hasUpdate;
    }

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { sfdcInstanceUrl: true, oauthAccessToken: true },
    });

    if (!org.sfdcInstanceUrl || !org.oauthAccessToken) {
      console.warn("[sync-flags] Org missing SFDC connection, skipping");
      return;
    }

    const sf = new SalesforceApi(org.sfdcInstanceUrl, org.oauthAccessToken);
    // Try unnamespaced first (self-hosted unpackaged deploy), then lrt__ namespace (managed package)
    let records = await sf.query<{ Id: string }>(
      "SELECT Id FROM Routing_Settings__c LIMIT 1"
    ).catch(() => [] as { Id: string }[]);
    let objectName = "Routing_Settings__c";

    if (!records.length) {
      records = await sf.query<{ Id: string }>(
        "SELECT Id FROM lrt__Routing_Settings__c LIMIT 1"
      ).catch(() => [] as { Id: string }[]);
      objectName = "lrt__Routing_Settings__c";
    }

    if (!records.length) {
      console.warn("[sync-flags] No Routing_Settings__c record found, skipping");
      return;
    }

    await sf.update(objectName, records[0].Id, flags);
  } catch (err) {
    console.warn("[sync-flags] Failed to sync routing flags:", err);
  }
}
