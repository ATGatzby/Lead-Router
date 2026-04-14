import { describe, it, expect, vi } from "vitest";
import { mockWebClient, mockLogger } from "../helpers";
import { handleListFlows } from "../../src/tools/list-flows.js";
import { handleGetFlow } from "../../src/tools/get-flow.js";
import { handleTestFlow } from "../../src/tools/test-flow.js";

// ---------------------------------------------------------------------------
// list_flows
// ---------------------------------------------------------------------------
describe("handleListFlows", () => {
  it("returns formatted flow list", async () => {
    const web = mockWebClient({
      listFlows: vi.fn().mockResolvedValue({
        flows: [{ id: "f1", objectType: "LEAD", name: "Lead Flow", nodeCount: 5, status: "ACTIVE" }],
      }),
    });
    const res = await handleListFlows(web, mockLogger());
    expect(res.content[0].text).toContain("Lead Flow");
    expect(res.content[0].text).toContain("LEAD");
  });

  it("returns empty message when no flows", async () => {
    const web = mockWebClient({ listFlows: vi.fn().mockResolvedValue({ flows: [] }) });
    const res = await handleListFlows(web, mockLogger());
    expect(res.content[0].text).toContain("No routing flows");
  });
});

// ---------------------------------------------------------------------------
// get_flow
// ---------------------------------------------------------------------------
describe("handleGetFlow", () => {
  it("returns flow details with nodes", async () => {
    const web = mockWebClient({
      getFlow: vi.fn().mockResolvedValue({
        name: "Lead Flow",
        objectType: "LEAD",
        status: "ACTIVE",
        id: "f1",
        nodes: [{ type: "CONDITION", label: "Check Revenue" }],
      }),
    });
    const res = await handleGetFlow(web, mockLogger(), { objectType: "LEAD" });
    expect(res.content[0].text).toContain("Lead Flow");
    expect(res.content[0].text).toContain("Check Revenue");
  });

  it("shows flow without nodes", async () => {
    const web = mockWebClient({
      getFlow: vi.fn().mockResolvedValue({
        objectType: "CONTACT",
        status: "DRAFT",
        id: "f2",
      }),
    });
    const res = await handleGetFlow(web, mockLogger(), { objectType: "CONTACT" });
    expect(res.content[0].text).toContain("CONTACT");
    expect(res.content[0].text).toContain("DRAFT");
  });
});

// ---------------------------------------------------------------------------
// test_flow
// ---------------------------------------------------------------------------
describe("handleTestFlow", () => {
  it("returns test result with path", async () => {
    const web = mockWebClient({
      testFlow: vi.fn().mockResolvedValue({
        outcome: "MATCHED",
        assignedTo: "Alice",
        path: [{ label: "Check Revenue", result: true }, { label: "Assign to Sales", result: "assigned" }],
      }),
    });
    const res = await handleTestFlow(web, mockLogger(), {
      objectType: "LEAD",
      fields: { AnnualRevenue: 500000 },
    });
    expect(res.content[0].text).toContain("MATCHED");
    expect(res.content[0].text).toContain("Alice");
    expect(res.content[0].text).toContain("Check Revenue");
  });

  it("returns result without path", async () => {
    const web = mockWebClient({
      testFlow: vi.fn().mockResolvedValue({ outcome: "NO_MATCH" }),
    });
    const res = await handleTestFlow(web, mockLogger(), {
      objectType: "LEAD",
      fields: { AnnualRevenue: 100 },
    });
    expect(res.content[0].text).toContain("NO_MATCH");
  });
});
