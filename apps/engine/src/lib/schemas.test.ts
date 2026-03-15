import { describe, it, expect } from "vitest";
import { routePayloadSchema, batchPayloadSchema } from "./schemas.js";

// ── routePayloadSchema ──────────────────────────────────────────────────────

describe("routePayloadSchema", () => {
  const validPayload = {
    sfdcOrgId: "00D000000000001",
    objectType: "LEAD",
    eventType: "INSERT",
    recordId: "00Q000000000001",
    timestamp: "2026-03-14T00:00:00Z",
    fields: { Email: "test@example.com" },
  };

  it("accepts INSERT eventType", () => {
    const result = routePayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("accepts UPDATE eventType", () => {
    const result = routePayloadSchema.safeParse({ ...validPayload, eventType: "UPDATE" });
    expect(result.success).toBe(true);
  });

  it("accepts BOTH eventType", () => {
    const result = routePayloadSchema.safeParse({ ...validPayload, eventType: "BOTH" });
    expect(result.success).toBe(true);
  });

  it("accepts SEARCH eventType", () => {
    const result = routePayloadSchema.safeParse({ ...validPayload, eventType: "SEARCH" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid eventType", () => {
    const result = routePayloadSchema.safeParse({ ...validPayload, eventType: "DELETE" });
    expect(result.success).toBe(false);
  });

  it("accepts optional ruleId", () => {
    const result = routePayloadSchema.safeParse({ ...validPayload, ruleId: "rule-123" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ruleId).toBe("rule-123");
    }
  });

  it("accepts payload without ruleId", () => {
    const result = routePayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ruleId).toBeUndefined();
    }
  });

  it("accepts all object types", () => {
    for (const objectType of ["LEAD", "CONTACT", "ACCOUNT"]) {
      const result = routePayloadSchema.safeParse({ ...validPayload, objectType });
      expect(result.success).toBe(true);
    }
  });

  it("rejects missing required fields", () => {
    const { sfdcOrgId, ...missing } = validPayload;
    const result = routePayloadSchema.safeParse(missing);
    expect(result.success).toBe(false);
  });
});

// ── batchPayloadSchema ──────────────────────────────────────────────────────

describe("batchPayloadSchema", () => {
  const validBatch = {
    sfdcOrgId: "00D000000000001",
    objectType: "LEAD",
    eventType: "INSERT",
    timestamp: "2026-03-14T00:00:00Z",
    records: [
      { recordId: "00Q000000000001", fields: { Email: "test@example.com" } },
    ],
  };

  it("accepts valid batch payload", () => {
    const result = batchPayloadSchema.safeParse(validBatch);
    expect(result.success).toBe(true);
  });

  it("accepts SEARCH eventType for batch", () => {
    const result = batchPayloadSchema.safeParse({ ...validBatch, eventType: "SEARCH" });
    expect(result.success).toBe(true);
  });

  it("accepts optional ruleId in batch", () => {
    const result = batchPayloadSchema.safeParse({ ...validBatch, ruleId: "rule-456" });
    expect(result.success).toBe(true);
  });

  it("rejects empty records array", () => {
    const result = batchPayloadSchema.safeParse({ ...validBatch, records: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than 200 records", () => {
    const records = Array.from({ length: 201 }, (_, i) => ({
      recordId: `00Q${String(i).padStart(12, "0")}`,
      fields: { Email: `test${i}@example.com` },
    }));
    const result = batchPayloadSchema.safeParse({ ...validBatch, records });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 200 records", () => {
    const records = Array.from({ length: 200 }, (_, i) => ({
      recordId: `00Q${String(i).padStart(12, "0")}`,
      fields: { Email: `test${i}@example.com` },
    }));
    const result = batchPayloadSchema.safeParse({ ...validBatch, records });
    expect(result.success).toBe(true);
  });

  it("rejects invalid eventType in batch", () => {
    const result = batchPayloadSchema.safeParse({ ...validBatch, eventType: "INVALID" });
    expect(result.success).toBe(false);
  });
});
