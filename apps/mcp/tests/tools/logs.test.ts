import { describe, it, expect, vi } from "vitest";
import { mockWebClient, mockLogger } from "../helpers";
import { handleGetRoutingLogs } from "../../src/tools/get-routing-logs.js";
import { handleGetRecordJourney } from "../../src/tools/get-record-journey.js";
import { handleGetRoutingStats } from "../../src/tools/get-routing-stats.js";
import { handleGetFailedLogs } from "../../src/tools/get-failed-logs.js";
import { handleRetryRouting } from "../../src/tools/retry-routing.js";
import { handleRetryAllFailed } from "../../src/tools/retry-all-failed.js";
import { handleDismissLog } from "../../src/tools/dismiss-log.js";

// ---------------------------------------------------------------------------
// get_routing_logs
// ---------------------------------------------------------------------------
describe("handleGetRoutingLogs", () => {
  it("returns formatted logs", async () => {
    const web = mockWebClient({
      getRoutingLogs: vi.fn().mockResolvedValue({
        logs: [{ crmRecordId: "00Q001", status: "SUCCESS", ruleName: "Enterprise", createdAt: new Date().toISOString() }],
        total: 1,
      }),
    });
    const res = await handleGetRoutingLogs(web, mockLogger(), {});
    expect(res.content[0].text).toContain("00Q001");
    expect(res.content[0].text).toContain("SUCCESS");
  });

  it("returns empty message", async () => {
    const web = mockWebClient({ getRoutingLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }) });
    const res = await handleGetRoutingLogs(web, mockLogger(), {});
    expect(res.content[0].text).toContain("No routing logs");
  });

  it("passes filters", async () => {
    const web = mockWebClient();
    await handleGetRoutingLogs(web, mockLogger(), { objectType: "LEAD", status: "FAILED", page: 2 });
    expect(web.getRoutingLogs).toHaveBeenCalledWith({ objectType: "LEAD", status: "FAILED", page: 2 });
  });
});

// ---------------------------------------------------------------------------
// get_record_journey
// ---------------------------------------------------------------------------
describe("handleGetRecordJourney", () => {
  it("returns journey events", async () => {
    const web = mockWebClient({
      getRecordJourney: vi.fn().mockResolvedValue({
        events: [
          { createdAt: new Date().toISOString(), status: "SUCCESS", ruleId: "r1", assignedToId: "u1" },
        ],
      }),
    });
    const res = await handleGetRecordJourney(web, mockLogger(), { recordId: "00Q001" });
    expect(res.content[0].text).toContain("00Q001");
    expect(res.content[0].text).toContain("SUCCESS");
  });

  it("returns no events message", async () => {
    const web = mockWebClient({
      getRecordJourney: vi.fn().mockResolvedValue({ events: [] }),
    });
    const res = await handleGetRecordJourney(web, mockLogger(), { recordId: "00Q999" });
    expect(res.content[0].text).toContain("No routing events");
  });
});

// ---------------------------------------------------------------------------
// get_routing_stats
// ---------------------------------------------------------------------------
describe("handleGetRoutingStats", () => {
  it("returns stats by status and object type", async () => {
    const web = mockWebClient({
      getRoutingStats: vi.fn().mockResolvedValue({
        stats: [
          { name: "Alice", total: 60, LEAD: 40, CONTACT: 20 },
          { name: "Bob", total: 40, LEAD: 20, CONTACT: 20 },
        ],
        period: "month",
      }),
    });
    const res = await handleGetRoutingStats(web, mockLogger());
    expect(res.content[0].text).toContain("Alice");
    expect(res.content[0].text).toContain("60 total");
    expect(res.content[0].text).toContain("Bob");
    expect(res.content[0].text).toContain("month");
  });
});

// ---------------------------------------------------------------------------
// get_failed_logs
// ---------------------------------------------------------------------------
describe("handleGetFailedLogs", () => {
  it("returns failed logs", async () => {
    const web = mockWebClient({
      getFailedLogs: vi.fn().mockResolvedValue({
        logs: [{ crmRecordId: "00Q001", status: "FAILED", createdAt: new Date().toISOString() }],
        total: 1,
      }),
    });
    const res = await handleGetFailedLogs(web, mockLogger(), {});
    expect(res.content[0].text).toContain("FAILED");
  });
});

// ---------------------------------------------------------------------------
// retry_routing
// ---------------------------------------------------------------------------
describe("handleRetryRouting", () => {
  it("returns preview", async () => {
    const web = mockWebClient();
    const res = await handleRetryRouting(web, mockLogger(), { logId: "log-1" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("log-1");
  });

  it("retries when confirmed", async () => {
    const web = mockWebClient({
      retryRouting: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
    });
    const res = await handleRetryRouting(web, mockLogger(), { logId: "log-1", confirm: true });
    expect(res.content[0].text).toContain("retried");
    expect(web.retryRouting).toHaveBeenCalledWith("log-1");
  });
});

// ---------------------------------------------------------------------------
// retry_all_failed
// ---------------------------------------------------------------------------
describe("handleRetryAllFailed", () => {
  it("returns preview", async () => {
    const web = mockWebClient();
    const res = await handleRetryAllFailed(web, mockLogger(), {});
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("ALL failed");
  });

  it("retries all when confirmed", async () => {
    const web = mockWebClient({
      retryAllFailed: vi.fn().mockResolvedValue({ count: 5 }),
    });
    const res = await handleRetryAllFailed(web, mockLogger(), { confirm: true });
    expect(res.content[0].text).toContain("retried");
    expect(res.content[0].text).toContain("5");
  });
});

// ---------------------------------------------------------------------------
// dismiss_log
// ---------------------------------------------------------------------------
describe("handleDismissLog", () => {
  it("returns preview", async () => {
    const web = mockWebClient();
    const res = await handleDismissLog(web, mockLogger(), { logId: "log-1" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("log-1");
  });

  it("dismisses when confirmed", async () => {
    const web = mockWebClient();
    const res = await handleDismissLog(web, mockLogger(), { logId: "log-1", confirm: true });
    expect(res.content[0].text).toContain("dismissed");
    expect(web.dismissLog).toHaveBeenCalledWith("log-1");
  });
});
