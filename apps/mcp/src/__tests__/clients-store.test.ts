import { describe, it, expect } from "vitest";
import { LeadRoutingClientsStore } from "../auth/clients-store.js";

describe("LeadRoutingClientsStore", () => {
  it("registerClient() returns a client with generated client_id", () => {
    const store = new LeadRoutingClientsStore();
    const client = store.registerClient({
      redirect_uris: ["https://example.com/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "Test Client",
      client_uri: "https://example.com",
    });

    expect(client.client_id).toBeDefined();
    expect(typeof client.client_id).toBe("string");
    expect(client.client_id.length).toBeGreaterThan(0);
    expect(client.client_id_issued_at).toBeDefined();
    expect(typeof client.client_id_issued_at).toBe("number");
    expect(client.redirect_uris).toEqual(["https://example.com/callback"]);
    expect(client.client_name).toBe("Test Client");
  });

  it("getClient() returns registered client", () => {
    const store = new LeadRoutingClientsStore();
    const registered = store.registerClient({
      redirect_uris: ["https://example.com/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "My Client",
      client_uri: "https://example.com",
    });

    const retrieved = store.getClient(registered.client_id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.client_id).toBe(registered.client_id);
    expect(retrieved!.client_name).toBe("My Client");
  });

  it("getClient() returns undefined for unknown client_id", () => {
    const store = new LeadRoutingClientsStore();
    const result = store.getClient("nonexistent-id");
    expect(result).toBeUndefined();
  });

  it("multiple clients can be registered independently", () => {
    const store = new LeadRoutingClientsStore();

    const client1 = store.registerClient({
      redirect_uris: ["https://a.example.com/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "Client A",
      client_uri: "https://a.example.com",
    });

    const client2 = store.registerClient({
      redirect_uris: ["https://b.example.com/cb"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "Client B",
      client_uri: "https://b.example.com",
    });

    // Different IDs
    expect(client1.client_id).not.toBe(client2.client_id);

    // Both retrievable
    const retrieved1 = store.getClient(client1.client_id);
    const retrieved2 = store.getClient(client2.client_id);
    expect(retrieved1!.client_name).toBe("Client A");
    expect(retrieved2!.client_name).toBe("Client B");
  });

  it("client_id_issued_at is a Unix timestamp in seconds", () => {
    const store = new LeadRoutingClientsStore();
    const before = Math.floor(Date.now() / 1000);
    const client = store.registerClient({
      redirect_uris: ["https://example.com/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: "Timestamp Client",
      client_uri: "https://example.com",
    });
    const after = Math.floor(Date.now() / 1000);

    expect(client.client_id_issued_at).toBeGreaterThanOrEqual(before);
    expect(client.client_id_issued_at).toBeLessThanOrEqual(after);
  });
});
