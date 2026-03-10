import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "crypto";

const ADMIN_SECRET = "test-secret-key-for-hmac";

describe("admin-auth", () => {
  beforeEach(() => {
    process.env.ADMIN_SECRET = ADMIN_SECRET;
  });

  afterEach(() => {
    delete process.env.ADMIN_SECRET;
    vi.restoreAllMocks();
  });

  describe("signAdminToken", () => {
    it("creates a valid HMAC-SHA256 token", async () => {
      const { signAdminToken } = await import("./admin-auth");
      const token = signAdminToken();

      // Token format: "<timestamp>.<hex-mac>"
      const parts = token.split(".");
      expect(parts).toHaveLength(2);

      const [ts, mac] = parts;
      expect(Number(ts)).toBeGreaterThan(0);
      expect(mac).toMatch(/^[0-9a-f]{64}$/); // SHA-256 = 64 hex chars

      // Verify the MAC is correct
      const expected = crypto
        .createHmac("sha256", ADMIN_SECRET)
        .update(ts)
        .digest("hex");
      expect(mac).toBe(expected);
    });

    it("throws when ADMIN_SECRET is not set", async () => {
      delete process.env.ADMIN_SECRET;
      const { signAdminToken } = await import("./admin-auth");
      expect(() => signAdminToken()).toThrow("ADMIN_SECRET env var is not set");
    });
  });

  describe("validateAdminToken", () => {
    it("accepts a valid token", async () => {
      const { signAdminToken, validateAdminToken } = await import(
        "./admin-auth"
      );
      const token = signAdminToken();
      expect(validateAdminToken(token)).toBe(true);
    });

    it("rejects expired token (>8 hours)", async () => {
      const { validateAdminToken } = await import("./admin-auth");
      // Create a token with a timestamp 9 hours ago
      const nineHoursAgo = (Date.now() - 9 * 60 * 60 * 1000).toString();
      const mac = crypto
        .createHmac("sha256", ADMIN_SECRET)
        .update(nineHoursAgo)
        .digest("hex");
      const expiredToken = `${nineHoursAgo}.${mac}`;
      expect(validateAdminToken(expiredToken)).toBe(false);
    });

    it("rejects tampered token", async () => {
      const { signAdminToken, validateAdminToken } = await import(
        "./admin-auth"
      );
      const token = signAdminToken();
      // Tamper with the MAC
      const [ts] = token.split(".");
      const tampered = `${ts}.${"a".repeat(64)}`;
      expect(validateAdminToken(tampered)).toBe(false);
    });

    it("rejects malformed token (no dot)", async () => {
      const { validateAdminToken } = await import("./admin-auth");
      expect(validateAdminToken("nodothere")).toBe(false);
    });

    it("rejects undefined token", async () => {
      const { validateAdminToken } = await import("./admin-auth");
      expect(validateAdminToken(undefined)).toBe(false);
    });

    it("rejects empty string token", async () => {
      const { validateAdminToken } = await import("./admin-auth");
      expect(validateAdminToken("")).toBe(false);
    });

    it("rejects token when ADMIN_SECRET is not set", async () => {
      const { signAdminToken, validateAdminToken } = await import(
        "./admin-auth"
      );
      const token = signAdminToken();
      delete process.env.ADMIN_SECRET;
      expect(validateAdminToken(token)).toBe(false);
    });

    it("rejects token with non-numeric timestamp", async () => {
      const { validateAdminToken } = await import("./admin-auth");
      const mac = crypto
        .createHmac("sha256", ADMIN_SECRET)
        .update("notanumber")
        .digest("hex");
      expect(validateAdminToken(`notanumber.${mac}`)).toBe(false);
    });
  });
});
