import { describe, it, expect } from "vitest";
import { previewResponse, successResponse, errorResponse } from "../src/utils/confirm.js";

describe("previewResponse", () => {
  it("wraps message with PREVIEW header and confirm instruction", () => {
    const res = previewResponse("Will create rule: Test");
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Will create rule: Test");
    expect(res.content[0].text).toContain("Call again with confirm: true to execute.");
  });

  it("does not set isError", () => {
    const res = previewResponse("test") as any;
    expect(res.isError).toBeUndefined();
  });
});

describe("successResponse", () => {
  it("returns message as-is", () => {
    const res = successResponse("Rule created successfully.");
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(res.content[0].text).toBe("Rule created successfully.");
  });

  it("does not set isError", () => {
    const res = successResponse("ok") as any;
    expect(res.isError).toBeUndefined();
  });
});

describe("errorResponse", () => {
  it("prefixes message with ERROR:", () => {
    const res = errorResponse("Something broke");
    expect(res.content).toHaveLength(1);
    expect(res.content[0].type).toBe("text");
    expect(res.content[0].text).toBe("ERROR: Something broke");
  });

  it("sets isError to true", () => {
    const res = errorResponse("fail");
    expect(res.isError).toBe(true);
  });
});
