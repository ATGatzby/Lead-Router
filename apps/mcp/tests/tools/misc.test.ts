import { describe, it, expect, vi } from "vitest";
import { mockWebClient, mockEngineClient, mockLogger } from "../helpers";
import { handleCheckHealth } from "../../src/tools/check-health.js";
import { handleGetSfdcStatus } from "../../src/tools/get-sfdc-status.js";
import { handleGetLicenseInfo } from "../../src/tools/get-license-info.js";
import { handleGetBulkRunStatus } from "../../src/tools/get-bulk-run-status.js";
import { handleCancelBulkRun } from "../../src/tools/cancel-bulk-run.js";
import { handleGetAuditLogs } from "../../src/tools/get-audit-logs.js";

// ---------------------------------------------------------------------------
// check_health
// ---------------------------------------------------------------------------
describe("handleCheckHealth", () => {
  it("returns healthy status", async () => {
    const engine = mockEngineClient({
      healthCheck: vi.fn().mockResolvedValue({ status: "ok", ts: "2026-01-01T00:00:00Z" }),
    });
    const res = await handleCheckHealth(engine, mockLogger());
    expect(res.content[0].text).toContain("healthy");
    expect(res.content[0].text).toContain("ok");
  });

  it("propagates engine errors", async () => {
    const engine = mockEngineClient({
      healthCheck: vi.fn().mockRejectedValue(new Error("Connection refused")),
    });
    await expect(handleCheckHealth(engine, mockLogger())).rejects.toThrow("Connection refused");
  });
});

// ---------------------------------------------------------------------------
// get_sfdc_status
// ---------------------------------------------------------------------------
describe("handleGetSfdcStatus", () => {
  it("returns CRM connection status", async () => {
    const web = mockWebClient({
      getSfdcStatus: vi.fn().mockResolvedValue({
        connected: true,
        orgId: "00Dxx0000000001",
        instanceUrl: "https://myorg.salesforce.com",
      }),
    });
    const res = await handleGetSfdcStatus(web, mockLogger());
    expect(res.content[0].text).toContain("Connected: true");
    expect(res.content[0].text).toContain("00Dxx0000000001");
  });
});

// ---------------------------------------------------------------------------
// get_license_info
// ---------------------------------------------------------------------------
describe("handleGetLicenseInfo", () => {
  it("returns license details", async () => {
    const web = mockWebClient({
      getLicenseInfo: vi.fn().mockResolvedValue({
        tier: "pro",
        licenseKey: "lk_abc123",
        validUntil: "2027-01-01",
        limits: { maxRules: 25, maxSeats: 10 },
        usage: { rules: 5, seats: 3 },
        crmType: "HUBSPOT",
      }),
    });
    const res = await handleGetLicenseInfo(web, mockLogger());
    expect(res.content[0].text).toContain("pro");
    expect(res.content[0].text).toContain("25");
    expect(res.content[0].text).toContain("10");
  });
});

// ---------------------------------------------------------------------------
// get_bulk_run_status
// ---------------------------------------------------------------------------
describe("handleGetBulkRunStatus", () => {
  it("returns bulk run details", async () => {
    const web = mockWebClient({
      getBulkRunStatus: vi.fn().mockResolvedValue({
        status: "COMPLETE",
        totalRecords: 100,
        processed: 100,
        routed: 95,
        failed: 5,
      }),
    });
    const res = await handleGetBulkRunStatus(web, mockLogger(), { runId: "run-1" });
    expect(res.content[0].text).toContain("COMPLETE");
    expect(res.content[0].text).toContain("100");
    expect(res.content[0].text).toContain("95");
  });
});

// ---------------------------------------------------------------------------
// cancel_bulk_run
// ---------------------------------------------------------------------------
describe("handleCancelBulkRun", () => {
  it("returns preview", async () => {
    const web = mockWebClient();
    const res = await handleCancelBulkRun(web, mockLogger(), { runId: "run-1" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("run-1");
  });

  it("cancels when confirmed", async () => {
    const web = mockWebClient();
    const res = await handleCancelBulkRun(web, mockLogger(), { runId: "run-1", confirm: true });
    expect(res.content[0].text).toContain("cancelled");
    expect(web.cancelBulkRun).toHaveBeenCalledWith("run-1");
  });
});

// ---------------------------------------------------------------------------
// get_audit_logs
// ---------------------------------------------------------------------------
describe("handleGetAuditLogs", () => {
  it("returns formatted audit logs", async () => {
    const web = mockWebClient({
      getAuditLogs: vi.fn().mockResolvedValue({
        logs: [{ action: "CREATE", entityType: "RULE", userName: "admin", createdAt: new Date().toISOString() }],
        total: 1,
      }),
    });
    const res = await handleGetAuditLogs(web, mockLogger(), {});
    expect(res.content[0].text).toContain("CREATE");
    expect(res.content[0].text).toContain("RULE");
  });

  it("returns empty message", async () => {
    const web = mockWebClient({
      getAuditLogs: vi.fn().mockResolvedValue({ logs: [] }),
    });
    const res = await handleGetAuditLogs(web, mockLogger(), {});
    expect(res.content[0].text).toContain("No audit logs");
  });
});
