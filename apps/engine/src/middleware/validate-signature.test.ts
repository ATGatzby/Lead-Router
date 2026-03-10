import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { validateHmac } from "./validate-signature.js";

// Helper to generate a valid signature for a given payload + secret
function sign(payload: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${hmac}`;
}

describe("validateHmac", () => {
  const secret = "test-webhook-secret";
  const payload = JSON.stringify({ recordId: "00Q1", eventType: "INSERT" });

  it("returns true for a valid HMAC signature", () => {
    const signature = sign(payload, secret);
    expect(validateHmac(payload, signature, secret)).toBe(true);
  });

  it("returns false for an invalid HMAC signature", () => {
    const signature = "sha256=0000000000000000000000000000000000000000000000000000000000000000";
    expect(validateHmac(payload, signature, secret)).toBe(false);
  });

  it("returns false when the secret is wrong", () => {
    const signature = sign(payload, "wrong-secret");
    expect(validateHmac(payload, signature, secret)).toBe(false);
  });

  it("returns false when the payload has been modified", () => {
    const signature = sign(payload, secret);
    const tampered = JSON.stringify({ recordId: "00Q1", eventType: "UPDATE" });
    expect(validateHmac(tampered, signature, secret)).toBe(false);
  });

  it("returns false when buffer lengths differ (timing-safe comparison catch)", () => {
    // A signature with a completely different length triggers the catch branch
    const shortSignature = "sha256=abc";
    expect(validateHmac(payload, shortSignature, secret)).toBe(false);
  });

  it("returns false for empty signature", () => {
    expect(validateHmac(payload, "", secret)).toBe(false);
  });

  it("returns true for empty payload with matching signature", () => {
    const emptyPayload = "";
    const signature = sign(emptyPayload, secret);
    expect(validateHmac(emptyPayload, signature, secret)).toBe(true);
  });
});
