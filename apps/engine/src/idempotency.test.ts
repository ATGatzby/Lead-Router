import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted so mocks are available when vi.mock factory runs
const { mockSet, mockPipeline, mockPipelineSet, mockPipelineExec } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockPipeline: vi.fn(),
  mockPipelineSet: vi.fn(),
  mockPipelineExec: vi.fn(),
}));

vi.mock("./redis.js", () => ({
  redis: {
    set: mockSet,
    pipeline: mockPipeline,
  },
}));

import { claimIdempotencyKey, claimIdempotencyKeys } from "./idempotency.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockPipeline.mockReturnValue({
    set: mockPipelineSet,
    exec: mockPipelineExec,
  });
  mockPipelineSet.mockReturnThis();
});

// ─── claimIdempotencyKey (single) ──────────────────────────────────────────

describe("claimIdempotencyKey", () => {
  it("returns true when key is new (SET NX returns OK)", async () => {
    mockSet.mockResolvedValue("OK");
    const result = await claimIdempotencyKey("org1", "rec1", "INSERT", "2026-01-01T00:00:00Z");
    expect(result).toBe(true);
    expect(mockSet).toHaveBeenCalledWith(
      "idem:org1:rec1:INSERT:2026-01-01T00:00:00Z",
      "1",
      "NX",
      "EX",
      3600
    );
  });

  it("returns false when key already exists (SET NX returns null)", async () => {
    mockSet.mockResolvedValue(null);
    const result = await claimIdempotencyKey("org1", "rec1", "INSERT", "2026-01-01T00:00:00Z");
    expect(result).toBe(false);
  });
});

// ─── claimIdempotencyKeys (bulk) ───────────────────────────────────────────

describe("claimIdempotencyKeys", () => {
  it("returns a map of recordId → isNew for multiple records", async () => {
    mockPipelineExec.mockResolvedValue([
      [null, "OK"],   // rec1 → new
      [null, null],   // rec2 → duplicate
      [null, "OK"],   // rec3 → new
    ]);

    const records = [
      { recordId: "rec1", eventType: "INSERT", timestamp: "t1" },
      { recordId: "rec2", eventType: "INSERT", timestamp: "t1" },
      { recordId: "rec3", eventType: "INSERT", timestamp: "t1" },
    ];

    const result = await claimIdempotencyKeys("org1", records);

    expect(result.get("rec1")).toBe(true);
    expect(result.get("rec2")).toBe(false);
    expect(result.get("rec3")).toBe(true);
    expect(result.size).toBe(3);
  });

  it("creates correct Redis keys via pipeline", async () => {
    mockPipelineExec.mockResolvedValue([[null, "OK"]]);

    await claimIdempotencyKeys("orgX", [
      { recordId: "00Q1", eventType: "UPDATE", timestamp: "2026-03-10T00:00:00Z" },
    ]);

    expect(mockPipelineSet).toHaveBeenCalledWith(
      "idem:orgX:00Q1:UPDATE:2026-03-10T00:00:00Z",
      "1",
      "NX",
      "EX",
      3600
    );
  });

  it("handles empty records array", async () => {
    mockPipelineExec.mockResolvedValue([]);
    const result = await claimIdempotencyKeys("org1", []);
    expect(result.size).toBe(0);
  });
});
