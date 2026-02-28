import type { Connection } from "jsforce";

export interface PushSettingsPayload {
  webhookSecret: string
  engineUrl: string  // e.g. "https://engine.acme.com" or "http://localhost:3001"
  appUrl: string     // e.g. "https://routing.acme.com" or "http://localhost:3000"
}

/**
 * Push all runtime settings to Salesforce after OAuth connect:
 *  - Routing_Settings__c (data API): Webhook_Secret__c, Engine_Endpoint__c, App_Url__c
 *  - Named Credential "RoutingEngine" (Metadata API): endpoint = engineUrl
 *  - Remote Site Setting "LeadRouterEngine" (Metadata API): url = engineUrl
 *
 * Named Credential and Remote Site Setting updates are fire-and-forget;
 * they may fail if the package hasn't been deployed yet, which is fine.
 */
export async function pushSettings(conn: Connection, payload: PushSettingsPayload): Promise<void> {
  const { webhookSecret, engineUrl, appUrl } = payload

  // 1. Update Routing_Settings__c org defaults (data API)
  const result = await conn.query<{ Id: string }>(
    "SELECT Id FROM Routing_Settings__c LIMIT 1"
  )
  const record = {
    Webhook_Secret__c: webhookSecret,
    Engine_Endpoint__c: engineUrl,
    App_Url__c: appUrl,
  }
  if (result.totalSize > 0) {
    await conn.sobject("Routing_Settings__c").update({
      Id: result.records[0].Id,
      ...record,
    })
  } else {
    await conn.sobject("Routing_Settings__c").create(record)
  }

  // 2. Upsert Named Credential via Metadata API — non-fatal if package not deployed yet
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (conn as any).metadata.upsert("NamedCredential", [{
      fullName: "RoutingEngine",
      label: "Routing Engine",
      endpoint: engineUrl,
      principalType: "Anonymous",
      protocol: "NoAuthentication",
      allowMergeFieldsInBody: false,
      allowMergeFieldsInHeader: false,
      generateAuthorizationHeader: false,
    }])
  } catch (err) {
    console.error("[pushSettings] Named Credential upsert failed:", err)
  }

  // 3. Upsert Remote Site Settings via Metadata API — non-fatal if package not deployed yet
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (conn as any).metadata.upsert("RemoteSiteSettings", [
      {
        fullName: "LeadRouterEngine",
        description: "Lead Router Engine endpoint",
        isActive: true,
        url: engineUrl,
        disableProtocolSecurity: false,
      },
      {
        fullName: "LeadRouterApp",
        description: "Lead Router App URL",
        isActive: true,
        url: appUrl,
        disableProtocolSecurity: false,
      },
    ])
  } catch (err) {
    console.error("[pushSettings] Remote Site Setting upsert failed:", err)
  }
}

/**
 * Backward-compatible shim — reads ENGINE_URL / APP_URL from env.
 * Prefer calling pushSettings() directly with explicit values.
 */
export function pushWebhookSecret(conn: Connection, secret: string): Promise<void> {
  return pushSettings(conn, {
    webhookSecret: secret,
    engineUrl: process.env.ENGINE_URL ?? "http://localhost:3001",
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
  })
}
