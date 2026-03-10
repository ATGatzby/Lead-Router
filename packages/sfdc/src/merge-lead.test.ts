import { describe, it, expect, vi } from "vitest";
import { mergeLead } from "./merge-lead.js";

describe("mergeLead", () => {
  function makeMockConnection(result: Record<string, any>) {
    const executeAnonymous = vi.fn().mockResolvedValue(result);
    const conn = {
      tooling: { executeAnonymous },
    } as any;
    return { conn, executeAnonymous };
  }

  it("executes Apex anonymous with correct merge DML", async () => {
    const { conn, executeAnonymous } = makeMockConnection({ success: true });

    await mergeLead(conn, "00Q000000000001", "00Q000000000002");

    expect(executeAnonymous).toHaveBeenCalledTimes(1);
    const apex = executeAnonymous.mock.calls[0][0] as string;
    expect(apex).toContain("Database.merge");
    expect(apex).toContain("00Q000000000001");
    expect(apex).toContain("00Q000000000002");
  });

  it("resolves on success", async () => {
    const { conn } = makeMockConnection({ success: true });

    await expect(
      mergeLead(conn, "00Q000000000001", "00Q000000000002")
    ).resolves.toBeUndefined();
  });

  it("throws with compileProblem on failure", async () => {
    const { conn } = makeMockConnection({
      success: false,
      compileProblem: "Variable does not exist: x",
    });

    await expect(
      mergeLead(conn, "00Q000000000001", "00Q000000000002")
    ).rejects.toThrow("Variable does not exist: x");
  });

  it("throws with exceptionMessage when compileProblem is null", async () => {
    const { conn } = makeMockConnection({
      success: false,
      compileProblem: null,
      exceptionMessage: "System.DmlException: Merge failed",
    });

    await expect(
      mergeLead(conn, "00Q000000000001", "00Q000000000002")
    ).rejects.toThrow("System.DmlException: Merge failed");
  });

  it("throws generic message when both error fields are null", async () => {
    const { conn } = makeMockConnection({
      success: false,
      compileProblem: null,
      exceptionMessage: null,
    });

    await expect(
      mergeLead(conn, "00Q000000000001", "00Q000000000002")
    ).rejects.toThrow("Apex Lead merge failed");
  });
});
