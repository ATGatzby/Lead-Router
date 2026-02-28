import crypto from "crypto";

/** Generate a cryptographically random HMAC secret for new orgs */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Generate a one-time invite token */
export function generateInviteToken(): string {
  return crypto.randomBytes(24).toString("hex"); // 48-char hex
}

/** Hash a password using PBKDF2. Returns "salt:hash" string. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, 310000, 32, "sha256")
    .toString("hex");
  return `${salt}:${hash}`;
}

/** Verify a password against a stored "salt:hash" string. Constant-time. */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto
    .pbkdf2Sync(password, salt, 310000, 32, "sha256")
    .toString("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(candidate, "hex")
    );
  } catch {
    return false;
  }
}

/** Verify HMAC-SHA256 signature from Apex trigger callouts */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  const expectedBuffer = Buffer.from(`sha256=${expected}`, "utf8");
  const sigBuffer = Buffer.from(signature, "utf8");
  if (expectedBuffer.length !== sigBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, sigBuffer);
}
