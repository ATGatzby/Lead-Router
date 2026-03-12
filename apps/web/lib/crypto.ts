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

// ─── Field-level encryption (AES-256-GCM) ────────────────────────────────────

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns "iv:authTag:ciphertext" (all hex-encoded).
 */
export function encryptField(plaintext: string, secret: string): string {
  const key = crypto.scryptSync(secret, "lead-routing-field-enc", 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a string produced by encryptField().
 * Expects "iv:authTag:ciphertext" format (all hex-encoded).
 */
export function decryptField(ciphertext: string, secret: string): string {
  const [ivHex, authTagHex, encrypted] = ciphertext.split(":");
  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error("Invalid encrypted field format");
  }
  const key = crypto.scryptSync(secret, "lead-routing-field-enc", 32);
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
