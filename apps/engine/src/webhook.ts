import { prisma } from "@lead-routing/db";

const WEBHOOK_TIMEOUT_MS = 3000;

export interface WebhookPayload {
  event: string;
  recordId: string;
  objectType: string;
  assigneeName: string;
  assigneeId: string;
  ruleName: string;
  ruleId: string;
  timestamp: string;
}

/**
 * Fire the org's configured notification webhook (non-blocking).
 * Errors are logged but never propagate — routing must not fail because of webhooks.
 */
export function fireWebhook(orgId: string, payload: WebhookPayload): void {
  // Intentionally not awaited — fire-and-forget
  _fire(orgId, payload).catch((err) => {
    console.warn(`[webhook] Failed for org ${orgId}:`, err);
  });
}

async function _fire(orgId: string, payload: WebhookPayload): Promise<void> {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { notificationWebhookUrl: true },
  });

  const url = org?.notificationWebhookUrl;
  if (!url) return; // not configured

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[webhook] Non-2xx response ${res.status} from ${url}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
