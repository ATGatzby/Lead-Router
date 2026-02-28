import crypto from "crypto";

/**
 * Validate the HMAC-SHA256 signature sent by the Salesforce Apex trigger.
 *
 * The Apex trigger sets the header as:
 *   X-Webhook-Signature: sha256=<hex>
 *
 * @param payload   - raw request body as a string
 * @param signature - value of the X-Webhook-Signature header
 * @param secret    - org-specific webhook secret from DB
 */
export function validateHmac(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  const expectedHeader = `sha256=${expected}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedHeader, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    // Buffer lengths differ → definitely invalid
    return false;
  }
}
