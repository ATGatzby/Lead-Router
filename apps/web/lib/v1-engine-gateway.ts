import crypto from "node:crypto";
import type { EngineGateway, RoutePayload, BatchPayload, RouteResult, BatchResult } from "@lead-routing/agent-api";

function signPayload(body: string): string {
  const secret = process.env.ENGINE_WEBHOOK_SECRET;
  if (!secret) throw new Error("ENGINE_WEBHOOK_SECRET not set");
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function engineFetch(path: string, payload: unknown): Promise<Response> {
  const engineUrl = process.env.ENGINE_URL;
  if (!engineUrl) throw new Error("ENGINE_URL not set");
  const body = JSON.stringify(payload);
  const signature = signPayload(body);
  return fetch(`${engineUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
    },
    body,
  });
}

export const engineGateway: EngineGateway = {
  async routeSingle(payload: RoutePayload): Promise<RouteResult> {
    const res = await engineFetch("/route", payload);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Engine returned ${res.status}: ${text}`);
    }
    return res.json() as Promise<RouteResult>;
  },

  async routeBatch(payload: BatchPayload): Promise<BatchResult> {
    const res = await engineFetch("/route/batch", payload);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Engine returned ${res.status}: ${text}`);
    }
    return res.json() as Promise<BatchResult>;
  },
};
