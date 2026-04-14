import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock WebClient
// ---------------------------------------------------------------------------
// Default every method to vi.fn() resolving to a sensible empty value.
// Tests override specific methods via the `overrides` param.
const WEB_CLIENT_DEFAULTS: Record<string, () => any> = {
  // Rules
  listRules: () => ({ rules: [] }),
  getRule: () => ({ rule: { id: "r1", name: "Test Rule", status: "ACTIVE" } }),
  createRule: () => ({ rule: { id: "r1", name: "New Rule" } }),
  updateRule: () => ({ rule: { id: "r1", name: "Updated Rule" } }),
  deleteRule: () => ({ success: true }),
  cloneRule: () => ({ rule: { id: "r2", name: "Cloned Rule" } }),
  reorderRules: () => ({ success: true }),
  testRule: () => ({ matched: true, branch: "Branch A" }),
  runScheduledRule: () => ({ runId: "run-1", status: "RUNNING" }),

  // Teams
  listTeams: () => ({ teams: [] }),
  getTeam: () => ({ team: { id: "t1", name: "Test Team" } }),
  createTeam: () => ({ team: { id: "t1", name: "New Team" } }),
  updateTeam: () => ({ team: { id: "t1", name: "Updated Team" } }),
  deleteTeam: () => ({ success: true }),

  // Team members
  addTeamMember: () => ({ added: 1 }),
  removeTeamMember: () => ({ success: true }),
  toggleTeamMember: () => ({ success: true }),
  updateTeamWeights: () => ({ success: true }),
  resetTeamPointer: () => ({ success: true }),

  // Users
  listUsers: () => ({ users: [] }),
  syncUsers: () => ({ synced: 5 }),
  licenseUser: () => ({ success: true }),
  delicenseUser: () => ({ success: true }),
  bulkLicenseUsers: () => ({ licensed: 3 }),
  licenseUsersByRole: () => ({ licensed: 2 }),
  licenseUsersByProfile: () => ({ licensed: 4 }),
  getUserStats: () => ({ total: 10, licensed: 5, active: 8 }),

  // Fields
  listFields: () => ({ fields: [] }),
  syncFields: () => ({ synced: 12 }),

  // Queues
  listQueues: () => ({ queues: [] }),
  syncQueues: () => ({ synced: 3 }),

  // Routing mode
  getRoutingMode: () => ({ LEAD: "CLASSIC", CONTACT: "CLASSIC", ACCOUNT: "CLASSIC" }),
  setRoutingMode: () => ({ success: true }),

  // SFDC / CRM status
  getSfdcStatus: () => ({ connected: true, orgId: "00D..." }),

  // Bulk runs
  getBulkRunStatus: () => ({ status: "COMPLETE", recordsRouted: 100 }),
  cancelBulkRun: () => ({ success: true }),

  // License
  getLicenseInfo: () => ({ tier: "PRO", validUntil: "2027-01-01" }),

  // Analytics
  getAnalyticsOverview: () => ({ totalRouted: 500, successRate: 94.2 }),
  getAnalyticsRules: () => ({ rules: [] }),
  getAnalyticsTeams: () => ({ teams: [] }),

  // Logs
  getRoutingLogs: () => ({ logs: [], total: 0 }),
  getRecordJourney: () => ({ journey: [] }),
  getRoutingStats: () => ({ total: 100, failed: 5 }),
  getFailedLogs: () => ({ logs: [], total: 0 }),
  retryRouting: () => ({ success: true }),
  retryAllFailed: () => ({ retried: 5 }),
  dismissLog: () => ({ success: true }),

  // Flows
  listFlows: () => ({ flows: [] }),
  getFlow: () => ({ flow: { objectType: "LEAD", steps: [] } }),
  testFlow: () => ({ matched: true }),

  // Audit logs
  getAuditLogs: () => ({ logs: [], total: 0 }),
};

export function mockWebClient(overrides: Record<string, any> = {}): any {
  const client: Record<string, any> = {};
  for (const [method, defaultReturn] of Object.entries(WEB_CLIENT_DEFAULTS)) {
    client[method] = overrides[method] ?? vi.fn().mockResolvedValue(defaultReturn());
  }
  // Proxy for any method not listed (future-proof)
  return new Proxy(client, {
    get: (target, prop: string) => {
      if (prop in target) return target[prop];
      return overrides[prop] ?? vi.fn().mockResolvedValue(null);
    },
  });
}

// ---------------------------------------------------------------------------
// Mock EngineClient
// ---------------------------------------------------------------------------
export function mockEngineClient(overrides: Record<string, any> = {}): any {
  return {
    healthCheck: overrides.healthCheck ?? vi.fn().mockResolvedValue({ status: "ok", ts: new Date().toISOString() }),
    routeSingle: overrides.routeSingle ?? vi.fn().mockResolvedValue({ status: "routed", latencyMs: 42 }),
    routeBatch: overrides.routeBatch ?? vi.fn().mockResolvedValue({ accepted: 5, duplicates: 0, batchId: "batch-1" }),
  };
}

// ---------------------------------------------------------------------------
// Mock Logger
// ---------------------------------------------------------------------------
export function mockLogger(): any {
  const calls: Array<{ tool: string; action: string; input?: any; result?: any; error?: string }> = [];
  return {
    log: vi.fn((entry: any) => calls.push(entry)),
    calls,
  };
}

// ---------------------------------------------------------------------------
// Mock Config
// ---------------------------------------------------------------------------
export function mockConfig(overrides: Partial<{
  engineUrl: string;
  appUrl: string;
  apiToken: string;
  webhookSecret: string;
  sfdcOrgId: string;
  crmOrgId: string;
  crmType: string;
  logDir: string;
}> = {}): any {
  return {
    engineUrl: "https://engine.test.com",
    appUrl: "https://app.test.com",
    apiToken: "lr_test_token_1234567890abcdef1234567890abcdef12345678",
    webhookSecret: "test-secret-123",
    sfdcOrgId: "00Dxx0000000001AAA",
    crmOrgId: "00Dxx0000000001AAA",
    crmType: "SALESFORCE",
    logDir: "/tmp/lead-routing-test",
    ...overrides,
  };
}
