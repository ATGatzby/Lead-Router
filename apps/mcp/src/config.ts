import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface McpConfig {
  engineUrl: string;
  appUrl: string;
  apiToken: string;
  webhookSecret: string;
  sfdcOrgId: string;
  crmOrgId: string;
  crmType: "SALESFORCE" | "HUBSPOT";
  logDir: string;
}

const MCP_CONFIG_PATH = join(homedir(), ".lead-routing", "mcp.json");

interface McpJsonFile {
  appUrl?: string;
  engineUrl?: string;
  webhookSecret?: string;
  apiToken?: string;
  sfdcOrgId?: string;
  crmOrgId?: string;
  crmType?: string;
}

/**
 * Load config from ~/.lead-routing/mcp.json (written by `lead-routing init`),
 * with env var overrides for any field.
 */
export function loadConfig(): McpConfig {
  let file: McpJsonFile = {};

  if (existsSync(MCP_CONFIG_PATH)) {
    try {
      file = JSON.parse(readFileSync(MCP_CONFIG_PATH, "utf-8"));
    } catch {
      // ignore parse errors
    }
  }

  // Env vars override file values
  const appUrl = process.env.APP_URL || file.appUrl;
  const engineUrl = process.env.ENGINE_URL || file.engineUrl;
  const webhookSecret = process.env.WEBHOOK_SECRET || process.env.ENGINE_WEBHOOK_SECRET || file.webhookSecret;
  const apiToken = process.env.API_TOKEN || file.apiToken || "";
  const sfdcOrgId = process.env.SFDC_ORG_ID || file.sfdcOrgId || "";
  const crmOrgId = process.env.CRM_ORG_ID || file.crmOrgId || sfdcOrgId;
  const crmType = (process.env.CRM_TYPE || file.crmType || "SALESFORCE") as "SALESFORCE" | "HUBSPOT";

  const missing: string[] = [];
  if (!appUrl) missing.push("appUrl");
  if (!engineUrl) missing.push("engineUrl");
  if (!webhookSecret) missing.push("webhookSecret");

  if (missing.length > 0) {
    console.error(`Missing config: ${missing.join(", ")}`);
    console.error(`\nRun 'lead-routing init' first — it auto-configures the MCP server.`);
    console.error(`Config file: ${MCP_CONFIG_PATH}`);
    process.exit(1);
  }

  return {
    engineUrl: engineUrl!.replace(/\/$/, ""),
    appUrl: appUrl!.replace(/\/$/, ""),
    apiToken,
    webhookSecret: webhookSecret!,
    sfdcOrgId,
    crmOrgId,
    crmType,
    logDir: process.env.LOG_DIR || join(homedir(), ".lead-routing"),
  };
}
