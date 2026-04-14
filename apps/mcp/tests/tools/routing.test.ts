import { describe, it, expect, vi } from "vitest";
import { mockEngineClient, mockLogger } from "../helpers";
import { handleRouteLead } from "../../src/tools/route-lead.js";
import { handleRouteBatch } from "../../src/tools/route-batch.js";

// ---------------------------------------------------------------------------
// route_lead
// ---------------------------------------------------------------------------
describe("handleRouteLead", () => {
  it("routes a single record and returns result", async () => {
    const engine = mockEngineClient({
      routeSingle: vi.fn().mockResolvedValue({ status: "routed", ruleId: "r1", assignedTo: "John" }),
    });
    const res = await handleRouteLead(engine, mockLogger(), {
      objectType: "LEAD",
      eventType: "INSERT",
      recordId: "00Q000001",
      fields: { Email: "test@example.com" },
    });
    expect(res.content[0].text).toContain("Routing complete");
    expect(res.content[0].text).toContain("routed");
    expect(res.content[0].text).toContain("John");
    expect(engine.routeSingle).toHaveBeenCalled();
  });

  it("propagates engine errors", async () => {
    const engine = mockEngineClient({
      routeSingle: vi.fn().mockRejectedValue(new Error("Engine unavailable")),
    });
    await expect(
      handleRouteLead(engine, mockLogger(), {
        objectType: "LEAD",
        eventType: "INSERT",
        recordId: "00Q000001",
        fields: {},
      })
    ).rejects.toThrow("Engine unavailable");
  });
});

// ---------------------------------------------------------------------------
// route_batch
// ---------------------------------------------------------------------------
describe("handleRouteBatch", () => {
  it("routes batch of records", async () => {
    const engine = mockEngineClient({
      routeBatch: vi.fn().mockResolvedValue({ accepted: 3, duplicates: 0, batchId: "b1" }),
    });
    const res = await handleRouteBatch(engine, mockLogger(), {
      objectType: "LEAD",
      eventType: "INSERT",
      records: [
        { recordId: "r1", fields: { Name: "A" } },
        { recordId: "r2", fields: { Name: "B" } },
        { recordId: "r3", fields: { Name: "C" } },
      ],
    });
    expect(res.content[0].text).toContain("Batch routing complete");
    expect(res.content[0].text).toContain("Total Records: 3");
    expect(res.content[0].text).toContain("Accepted: 3");
  });

  it("returns message for empty records", async () => {
    const engine = mockEngineClient();
    const res = await handleRouteBatch(engine, mockLogger(), {
      objectType: "LEAD",
      eventType: "INSERT",
    });
    expect(res.content[0].text).toContain("No records provided");
  });

  it("logs batch execution", async () => {
    const engine = mockEngineClient();
    const logger = mockLogger();
    await handleRouteBatch(engine, logger, {
      objectType: "LEAD",
      eventType: "INSERT",
      records: [{ recordId: "r1", fields: {} }],
    });
    expect(logger.log).toHaveBeenCalled();
  });
});
