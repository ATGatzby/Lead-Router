import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We need to mock fs before importing config
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readFileSync } from "node:fs";
import { loadConfig } from "../src/config.js";

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;
const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;

describe("loadConfig", () => {
  const originalEnv = { ...process.env };
  const originalExit = process.exit;

  beforeEach(() => {
    vi.resetAllMocks();
    // Set required env vars so process.exit is not called
    process.env.APP_URL = "https://app.test.com";
    process.env.ENGINE_URL = "https://engine.test.com";
    process.env.WEBHOOK_SECRET = "secret-123";
    process.env.API_TOKEN = "token-123";
    process.env.CRM_ORG_ID = "00Dxx001";
    process.env.CRM_TYPE = "SALESFORCE";
    // Mock process.exit to throw instead
    process.exit = vi.fn(() => { throw new Error("process.exit"); }) as any;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.exit = originalExit;
  });

  it("loads config from env vars", () => {
    mockExistsSync.mockReturnValue(false);
    const config = loadConfig();
    expect(config.appUrl).toBe("https://app.test.com");
    expect(config.engineUrl).toBe("https://engine.test.com");
    expect(config.webhookSecret).toBe("secret-123");
    expect(config.crmOrgId).toBe("00Dxx001");
    expect(config.crmType).toBe("SALESFORCE");
  });

  it("strips trailing slash from URLs", () => {
    process.env.APP_URL = "https://app.test.com/";
    process.env.ENGINE_URL = "https://engine.test.com/";
    mockExistsSync.mockReturnValue(false);
    const config = loadConfig();
    expect(config.appUrl).toBe("https://app.test.com");
    expect(config.engineUrl).toBe("https://engine.test.com");
  });

  it("falls back to file values when env vars are missing", () => {
    delete process.env.APP_URL;
    delete process.env.ENGINE_URL;
    delete process.env.WEBHOOK_SECRET;
    delete process.env.API_TOKEN;
    delete process.env.CRM_ORG_ID;
    delete process.env.CRM_TYPE;

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        appUrl: "https://file-app.test.com",
        engineUrl: "https://file-engine.test.com",
        webhookSecret: "file-secret",
        apiToken: "file-token",
        crmOrgId: "00Dxx002",
        crmType: "HUBSPOT",
      })
    );

    const config = loadConfig();
    expect(config.appUrl).toBe("https://file-app.test.com");
    expect(config.engineUrl).toBe("https://file-engine.test.com");
    expect(config.webhookSecret).toBe("file-secret");
    expect(config.crmOrgId).toBe("00Dxx002");
    expect(config.crmType).toBe("HUBSPOT");
  });

  it("env vars override file values", () => {
    process.env.APP_URL = "https://env-app.test.com";
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        appUrl: "https://file-app.test.com",
        engineUrl: "https://file-engine.test.com",
        webhookSecret: "file-secret",
      })
    );

    const config = loadConfig();
    expect(config.appUrl).toBe("https://env-app.test.com");
  });

  it("SFDC_ORG_ID falls back when CRM_ORG_ID is missing", () => {
    delete process.env.CRM_ORG_ID;
    process.env.SFDC_ORG_ID = "00Dxx003";
    mockExistsSync.mockReturnValue(false);

    const config = loadConfig();
    expect(config.crmOrgId).toBe("00Dxx003");
    expect(config.sfdcOrgId).toBe("00Dxx003");
  });

  it("defaults crmType to SALESFORCE", () => {
    delete process.env.CRM_TYPE;
    mockExistsSync.mockReturnValue(false);

    const config = loadConfig();
    expect(config.crmType).toBe("SALESFORCE");
  });

  it("exits when required config is missing", () => {
    delete process.env.APP_URL;
    delete process.env.ENGINE_URL;
    delete process.env.WEBHOOK_SECRET;
    mockExistsSync.mockReturnValue(false);

    expect(() => loadConfig()).toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  it("ENGINE_WEBHOOK_SECRET env var works as fallback", () => {
    delete process.env.WEBHOOK_SECRET;
    process.env.ENGINE_WEBHOOK_SECRET = "engine-secret";
    mockExistsSync.mockReturnValue(false);

    const config = loadConfig();
    expect(config.webhookSecret).toBe("engine-secret");
  });
});
