import { describe, it, expect, vi, afterEach } from "vitest";
import { getPlanLimits, startOfNextMonth } from "./plan-limits.js";

describe("getPlanLimits", () => {
  it('returns correct limits for FREE plan', () => {
    const limits = getPlanLimits("FREE");
    expect(limits).toEqual({
      seats: 5,
      routingLeadsPerMonth: 100_000,
    });
  });

  it('returns correct limits for PAID plan', () => {
    const limits = getPlanLimits("PAID");
    expect(limits).toEqual({
      seats: 20,
      routingLeadsPerMonth: 100_000,
    });
  });
});

describe("startOfNextMonth", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the 1st of next month at 00:00:00 UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T14:30:00Z"));

    const result = startOfNextMonth();

    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(3); // April (0-indexed)
    expect(result.getUTCDate()).toBe(1);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });

  it("in December returns Jan 1 of next year", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-20T08:00:00Z"));

    const result = startOfNextMonth();

    expect(result.getUTCFullYear()).toBe(2027);
    expect(result.getUTCMonth()).toBe(0); // January
    expect(result.getUTCDate()).toBe(1);
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
  });
});
