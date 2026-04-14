import { describe, it, expect, vi } from "vitest";
import { mockWebClient, mockLogger } from "../helpers";
import { handleListFields } from "../../src/tools/list-fields.js";
import { handleSyncFields } from "../../src/tools/sync-fields.js";
import { handleListQueues } from "../../src/tools/list-queues.js";
import { handleSyncQueues } from "../../src/tools/sync-queues.js";

// ---------------------------------------------------------------------------
// list_fields
// ---------------------------------------------------------------------------
describe("handleListFields", () => {
  it("returns field list", async () => {
    const web = mockWebClient({
      listFields: vi.fn().mockResolvedValue({
        fields: [
          { name: "AnnualRevenue", type: "NUMBER" },
          { name: "Industry", type: "PICKLIST", picklistValues: ["Tech", "Finance"] },
        ],
      }),
    });
    const res = await handleListFields(web, mockLogger(), {});
    expect(res.content[0].text).toContain("AnnualRevenue");
    expect(res.content[0].text).toContain("2 values");
  });

  it("returns empty message", async () => {
    const web = mockWebClient({ listFields: vi.fn().mockResolvedValue({ fields: [] }) });
    const res = await handleListFields(web, mockLogger(), {});
    expect(res.content[0].text).toContain("No fields found");
  });
});

// ---------------------------------------------------------------------------
// sync_fields
// ---------------------------------------------------------------------------
describe("handleSyncFields", () => {
  it("returns preview when not confirmed", async () => {
    const web = mockWebClient();
    const res = await handleSyncFields(web, mockLogger(), {});
    expect(res.content[0].text).toContain("PREVIEW");
    expect(web.syncFields).not.toHaveBeenCalled();
  });

  it("syncs when confirmed", async () => {
    const web = mockWebClient({
      syncFields: vi.fn().mockResolvedValue({ synced: 42 }),
    });
    const res = await handleSyncFields(web, mockLogger(), { confirm: true });
    expect(res.content[0].text).toContain("sync completed");
    expect(res.content[0].text).toContain("42");
  });
});

// ---------------------------------------------------------------------------
// list_queues
// ---------------------------------------------------------------------------
describe("handleListQueues", () => {
  it("returns queue list", async () => {
    const web = mockWebClient({
      listQueues: vi.fn().mockResolvedValue({
        queues: [{ id: "q1", name: "Support Queue", sObjectType: "Case" }],
      }),
    });
    const res = await handleListQueues(web, mockLogger());
    expect(res.content[0].text).toContain("Support Queue");
    expect(res.content[0].text).toContain("Case");
  });

  it("returns empty message", async () => {
    const web = mockWebClient({ listQueues: vi.fn().mockResolvedValue({ queues: [] }) });
    const res = await handleListQueues(web, mockLogger());
    expect(res.content[0].text).toContain("No queues found");
  });
});

// ---------------------------------------------------------------------------
// sync_queues
// ---------------------------------------------------------------------------
describe("handleSyncQueues", () => {
  it("returns preview when not confirmed", async () => {
    const web = mockWebClient();
    const res = await handleSyncQueues(web, mockLogger(), {});
    expect(res.content[0].text).toContain("PREVIEW");
    expect(web.syncQueues).not.toHaveBeenCalled();
  });

  it("syncs when confirmed", async () => {
    const web = mockWebClient({
      syncQueues: vi.fn().mockResolvedValue({ synced: 5 }),
    });
    const res = await handleSyncQueues(web, mockLogger(), { confirm: true });
    expect(res.content[0].text).toContain("sync completed");
    expect(res.content[0].text).toContain("5");
  });
});
