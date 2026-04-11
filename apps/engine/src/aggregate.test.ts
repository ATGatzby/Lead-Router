import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  conversionTracking: {
    create: vi.fn().mockResolvedValue({}),
  },
}));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { updateAggregates, createConversionTracking } from "./aggregate.js";

/* ------------------------------------------------------------------ */
/*  Shared fixtures                                                    */
/* ------------------------------------------------------------------ */

const baseInput = {
  orgId: "org-1",
  date: new Date("2026-03-10T14:30:00Z"),
  ruleId: null as string | null,
  pathLabel: null as string | null,
  branchId: null as string | null,
  teamId: null as string | null,
  assigneeId: null as string | null,
  objectType: "LEAD" as const,
  status: "SUCCESS" as const,
  durationMs: 120 as number | null,
};

/* ------------------------------------------------------------------ */
/*  updateAggregates                                                   */
/* ------------------------------------------------------------------ */

describe("updateAggregates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$executeRawUnsafe.mockResolvedValue(1);
  });

  it("fires only org-level upsert when all dimension IDs are null", async () => {
    await updateAggregates({ ...baseInput });

    // 1 atomic INSERT ... ON CONFLICT per dimension level
    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("fires org-level + per-rule upserts when ruleId is provided", async () => {
    await updateAggregates({ ...baseInput, ruleId: "rule-1" });

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("fires org-level + per-rule + per-path upserts when ruleId and pathLabel are provided", async () => {
    await updateAggregates({
      ...baseInput,
      ruleId: "rule-1",
      pathLabel: "Path A",
      branchId: "branch-1",
    });

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
  });

  it("does NOT fire per-path upsert when pathLabel is set but ruleId is null", async () => {
    await updateAggregates({ ...baseInput, pathLabel: "Path A" });

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("fires per-team upsert when teamId is provided", async () => {
    await updateAggregates({ ...baseInput, teamId: "team-1" });

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("fires per-assignee upsert when assigneeId is provided", async () => {
    await updateAggregates({ ...baseInput, assigneeId: "user-1" });

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
  });

  it("fires per-team AND per-assignee when both teamId and assigneeId are provided", async () => {
    await updateAggregates({
      ...baseInput,
      teamId: "team-1",
      assigneeId: "user-1",
    });

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(3);
  });

  it("fires all 5 dimension upserts when every field is populated", async () => {
    await updateAggregates({
      ...baseInput,
      ruleId: "rule-1",
      pathLabel: "Path A",
      branchId: "branch-1",
      teamId: "team-1",
      assigneeId: "user-1",
    });

    expect(mockPrisma.$executeRawUnsafe).toHaveBeenCalledTimes(5);
  });

  it("does not throw when $executeRawUnsafe rejects", async () => {
    mockPrisma.$executeRawUnsafe.mockRejectedValue(new Error("db down"));

    // Should resolve without throwing thanks to Promise.allSettled
    await expect(updateAggregates({ ...baseInput })).resolves.toBeUndefined();
  });

  it("passes status increments correctly for FAILED status", async () => {
    await updateAggregates({ ...baseInput, status: "FAILED" });

    const args = mockPrisma.$executeRawUnsafe.mock.calls[0];
    // New param order: [sql, id, orgId, date, ruleId, pathLabel, branchId, teamId, assigneeId, objectType, success, failed, unmatched, merged, durationMs]
    expect(args[10]).toBe(0); // success_count increment
    expect(args[11]).toBe(1); // failed_count increment
    expect(args[12]).toBe(0); // unmatched_count increment
    expect(args[13]).toBe(0); // merged_count increment
  });

  it("passes status increments correctly for UNMATCHED status", async () => {
    await updateAggregates({ ...baseInput, status: "UNMATCHED" });

    const args = mockPrisma.$executeRawUnsafe.mock.calls[0];
    expect(args[10]).toBe(0); // success
    expect(args[11]).toBe(0); // failed
    expect(args[12]).toBe(1); // unmatched
    expect(args[13]).toBe(0); // merged
  });

  it("passes status increments correctly for MERGED status", async () => {
    await updateAggregates({ ...baseInput, status: "MERGED" });

    const args = mockPrisma.$executeRawUnsafe.mock.calls[0];
    expect(args[10]).toBe(0); // success
    expect(args[11]).toBe(0); // failed
    expect(args[12]).toBe(0); // unmatched
    expect(args[13]).toBe(1); // merged
  });

  it("passes durationMs as null when not provided", async () => {
    await updateAggregates({ ...baseInput, durationMs: null });

    const args = mockPrisma.$executeRawUnsafe.mock.calls[0];
    expect(args[14]).toBeNull(); // durationMs parameter
  });

  it("normalises date to start of UTC day", async () => {
    await updateAggregates({
      ...baseInput,
      date: new Date("2026-03-10T18:45:30.123Z"),
    });

    const args = mockPrisma.$executeRawUnsafe.mock.calls[0];
    const dateArg = args[3] as Date; // date is param $3
    expect(dateArg.toISOString()).toBe("2026-03-10T00:00:00.000Z");
  });
});

/* ------------------------------------------------------------------ */
/*  createConversionTracking                                           */
/* ------------------------------------------------------------------ */

describe("createConversionTracking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.conversionTracking.create.mockResolvedValue({});
  });

  const trackingInput = {
    orgId: "org-1",
    routingLogId: "log-1",
    crmRecordId: "00Q000000000001",
    ruleId: "rule-1",
    ruleName: "Enterprise Rule",
    pathLabel: "Path A",
    teamId: "team-1",
    assigneeId: "user-1",
    assigneeName: "Jane Doe",
  };

  it("calls prisma.conversionTracking.create with the correct data", async () => {
    await createConversionTracking(trackingInput);

    expect(mockPrisma.conversionTracking.create).toHaveBeenCalledOnce();
    expect(mockPrisma.conversionTracking.create).toHaveBeenCalledWith({
      data: {
        orgId: "org-1",
        routingLogId: "log-1",
        crmRecordId: "00Q000000000001",
        ruleId: "rule-1",
        ruleName: "Enterprise Rule",
        pathLabel: "Path A",
        teamId: "team-1",
        assigneeId: "user-1",
        assigneeName: "Jane Doe",
      },
    });
  });

  it("passes null fields through unchanged", async () => {
    const nullInput = {
      ...trackingInput,
      ruleId: null,
      ruleName: null,
      pathLabel: null,
      teamId: null,
      assigneeId: null,
      assigneeName: null,
    };

    await createConversionTracking(nullInput);

    const callArg = mockPrisma.conversionTracking.create.mock.calls[0][0];
    expect(callArg.data.ruleId).toBeNull();
    expect(callArg.data.ruleName).toBeNull();
    expect(callArg.data.pathLabel).toBeNull();
    expect(callArg.data.teamId).toBeNull();
    expect(callArg.data.assigneeId).toBeNull();
    expect(callArg.data.assigneeName).toBeNull();
  });

  it("does not throw when prisma.conversionTracking.create rejects", async () => {
    mockPrisma.conversionTracking.create.mockRejectedValue(
      new Error("unique constraint violation"),
    );

    await expect(
      createConversionTracking(trackingInput),
    ).resolves.toBeUndefined();
  });

  it("logs error to console.error when create fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("db write failed");
    mockPrisma.conversionTracking.create.mockRejectedValue(error);

    await createConversionTracking(trackingInput);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[aggregate] Failed to create conversion tracking:",
      error,
    );
    consoleSpy.mockRestore();
  });
});
