import { describe, it, expect } from "vitest";

describe("MCP Auth endpoints", () => {
  it("authorize route exports GET handler", async () => {
    const mod = await import("../authorize/route");
    expect(typeof mod.GET).toBe("function");
  });

  it("token route exports POST handler", async () => {
    const mod = await import("../token/route");
    expect(typeof mod.POST).toBe("function");
  });
});
