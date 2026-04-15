import { describe, it, expect } from "vitest";
import { ok, fail } from "../src/types.js";

describe("ok()", () => {
  it("creates a successful response", () => {
    const response = ok(
      { teamId: "t1", name: "West Coast" },
      ["Created team"],
      "setup_team",
      "SALESFORCE",
      42,
    );

    expect(response.success).toBe(true);
    expect(response.data).toEqual({ teamId: "t1", name: "West Coast" });
    expect(response.actions_taken).toEqual(["Created team"]);
    expect(response._meta.tool).toBe("setup_team");
    expect(response._meta.crm_type).toBe("SALESFORCE");
    expect(response._meta.duration_ms).toBe(42);
    expect(response.error).toBeUndefined();
  });

  it("includes optional warnings and next_actions", () => {
    const response = ok(
      { id: "1" },
      ["Did something"],
      "test_tool",
      "HUBSPOT",
      10,
      {
        warnings: ["Watch out"],
        next_actions: [{ action: "do_more", reason: "Because" }],
      },
    );

    expect(response.warnings).toEqual(["Watch out"]);
    expect(response.next_actions).toEqual([{ action: "do_more", reason: "Because" }]);
  });
});

describe("fail()", () => {
  it("creates a failure response", () => {
    const response = fail(
      "NOT_FOUND",
      "Team not found",
      "Check the ID",
      "setup_team",
      "SALESFORCE",
      15,
    );

    expect(response.success).toBe(false);
    expect(response.data).toBeNull();
    expect(response.actions_taken).toEqual([]);
    expect(response.error).toEqual({
      code: "NOT_FOUND",
      message: "Team not found",
      remediation: "Check the ID",
    });
    expect(response._meta.tool).toBe("setup_team");
    expect(response._meta.crm_type).toBe("SALESFORCE");
    expect(response._meta.duration_ms).toBe(15);
  });
});
