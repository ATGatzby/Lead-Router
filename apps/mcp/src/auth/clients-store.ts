import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { randomUUID } from "node:crypto";

/**
 * In-memory dynamic client registration store.
 *
 * Claude.ai (and other MCP hosts) call the /register endpoint before starting
 * the OAuth flow. We store the registered client metadata in memory — a restart
 * means clients re-register, which is fine for this use-case because the access
 * tokens remain valid (they're real API tokens persisted in Postgres).
 */
export class LeadRoutingClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  getClient(clientId: string): OAuthClientInformationFull | undefined {
    return this.clients.get(clientId);
  }

  registerClient(
    client: Omit<OAuthClientInformationFull, "client_id" | "client_id_issued_at">,
  ): OAuthClientInformationFull {
    const clientId = randomUUID();
    const full: OAuthClientInformationFull = {
      ...client,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(clientId, full);
    return full;
  }
}
