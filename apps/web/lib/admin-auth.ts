import crypto from "crypto";

const TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours

export function signAdminToken(): string {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) throw new Error("ADMIN_SECRET env var is not set");
  const ts = Date.now().toString();
  const mac = crypto.createHmac("sha256", secret).update(ts).digest("hex");
  return `${ts}.${mac}`;
}

export function validateAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;

  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return false;

  const ts = token.slice(0, dotIndex);
  const mac = token.slice(dotIndex + 1);
  if (!ts || !mac) return false;

  // Reject tokens older than 8 hours
  const age = Date.now() - Number(ts);
  if (isNaN(age) || age > TOKEN_MAX_AGE_MS) return false;

  const expected = crypto.createHmac("sha256", secret).update(ts).digest("hex");

  try {
    const macBuf = Buffer.from(mac, "hex");
    const expectedBuf = Buffer.from(expected, "hex");
    if (macBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(macBuf, expectedBuf);
  } catch {
    return false;
  }
}
