import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookSubscription } from './types';

const WEBHOOKS_BASE = 'https://api.hubapi.com';

/**
 * Manage HubSpot webhook subscriptions for a developer app.
 *
 * Unlike the other API classes, this uses a developer API key for
 * authentication (not OAuth tokens).
 */
export class WebhooksApi {
  constructor(
    private developerApiKey: string,
    private appId: string,
  ) {}

  /**
   * List all webhook subscriptions for the app.
   */
  async listSubscriptions(): Promise<WebhookSubscription[]> {
    const url = `${WEBHOOKS_BASE}/webhooks/v3/${this.appId}/subscriptions?hapikey=${this.developerApiKey}`;
    const res = await fetch(url);

    if (!res.ok) {
      const err = await res.text();
      throw new Error(
        `Failed to list webhook subscriptions (${res.status}): ${err}`,
      );
    }

    const body = (await res.json()) as { results: WebhookSubscription[] };
    return body.results;
  }

  /**
   * Create a new webhook subscription.
   *
   * @param subscriptionType - e.g. "contact.creation", "company.propertyChange"
   * @param propertyName     - Required when subscriptionType is a propertyChange type.
   */
  async createSubscription(
    subscriptionType: string,
    propertyName?: string,
  ): Promise<WebhookSubscription> {
    const url = `${WEBHOOKS_BASE}/webhooks/v3/${this.appId}/subscriptions?hapikey=${this.developerApiKey}`;
    const payload: Record<string, unknown> = {
      subscriptionType,
      active: true,
    };
    if (propertyName) {
      payload.propertyName = propertyName;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(
        `Failed to create webhook subscription (${res.status}): ${err}`,
      );
    }

    return (await res.json()) as WebhookSubscription;
  }

  /**
   * Delete a webhook subscription.
   *
   * @param subscriptionId - The subscription ID to remove.
   */
  async deleteSubscription(subscriptionId: number): Promise<void> {
    const url = `${WEBHOOKS_BASE}/webhooks/v3/${this.appId}/subscriptions/${subscriptionId}?hapikey=${this.developerApiKey}`;
    const res = await fetch(url, { method: 'DELETE' });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(
        `Failed to delete webhook subscription (${res.status}): ${err}`,
      );
    }
  }

  /**
   * Validate a HubSpot webhook signature (v3).
   *
   * The expected signature is an SHA-256 HMAC of
   * `{method}{url}{body}{timestamp}` using the app's client secret.
   *
   * @param requestBody  - Raw request body string.
   * @param signature    - Value of the X-HubSpot-Signature-v3 header.
   * @param clientSecret - The app's client secret (used as HMAC key).
   * @param url          - Full request URL including protocol.
   * @param method       - HTTP method (e.g. "POST").
   * @param timestamp    - Value of the X-HubSpot-Request-Timestamp header.
   * @returns `true` when the signature is valid.
   */
  validateSignature(
    requestBody: string,
    signature: string,
    clientSecret: string,
    url: string,
    method: string,
    timestamp: string,
  ): boolean {
    const sourceString = `${method}${url}${requestBody}${timestamp}`;
    const hash = createHmac('sha256', clientSecret)
      .update(sourceString)
      .digest('base64');

    // Use timing-safe comparison to prevent timing attacks
    try {
      return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
    } catch {
      // Buffers of different lengths throw — that means mismatch
      return false;
    }
  }
}
