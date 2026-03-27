import { signPayload } from "./hmac.js";
import type { McpConfig } from "../config.js";

export class EngineClient {
  constructor(private config: McpConfig) {}

  async healthCheck() {
    const res = await fetch(`${this.config.engineUrl}/health`);
    if (!res.ok) throw new Error(`Engine health check failed: ${res.status}`);
    return res.json();
  }

  async routeSingle(payload: {
    objectType: string;
    eventType: string;
    recordId: string;
    fields: Record<string, unknown>;
    ruleId?: string;
  }) {
    const body = JSON.stringify({
      sfdcOrgId: this.config.sfdcOrgId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
    const signature = signPayload(body, this.config.webhookSecret);
    const res = await fetch(`${this.config.engineUrl}/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-256": signature,
      },
      body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Route failed (${res.status}): ${JSON.stringify(err)}`);
    }
    return res.json();
  }

  async routeBatch(payload: {
    objectType: string;
    eventType: string;
    records: Array<{ recordId: string; fields: Record<string, unknown> }>;
    ruleId?: string;
  }) {
    const body = JSON.stringify({
      sfdcOrgId: this.config.sfdcOrgId,
      ...payload,
      timestamp: new Date().toISOString(),
    });
    const signature = signPayload(body, this.config.webhookSecret);
    const res = await fetch(`${this.config.engineUrl}/route/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-256": signature,
      },
      body,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`Batch route failed (${res.status}): ${JSON.stringify(err)}`);
    }
    return res.json();
  }
}
