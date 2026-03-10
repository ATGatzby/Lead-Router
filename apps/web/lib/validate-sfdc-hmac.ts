import crypto from "crypto";
import { prisma } from "@lead-routing/db";

/**
 * Validate HMAC signature from Salesforce Apex callouts.
 * Header: X-Signature-256: sha256=<hex>
 * Body is signed with the org's webhookSecret.
 */
export async function validateSfdcHmac(
  sfdcOrgId: string,
  body: string,
  signatureHeader: string | null
): Promise<boolean> {
  if (!signatureHeader) return false;

  const org = await prisma.organization.findUnique({
    where: { sfdcOrgId },
    select: { webhookSecret: true },
  });

  if (!org?.webhookSecret) return false;

  const expected = "sha256=" + crypto
    .createHmac("sha256", org.webhookSecret)
    .update(body)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    );
  } catch {
    return false; // Length mismatch
  }
}
