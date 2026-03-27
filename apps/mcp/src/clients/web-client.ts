import type { McpConfig } from "../config.js";

export class WebClient {
  private headers: Record<string, string>;

  constructor(private config: McpConfig) {
    this.headers = {
      "Authorization": `Bearer ${config.apiToken}`,
      "Content-Type": "application/json",
    };
  }

  private async request(path: string, options?: RequestInit) {
    const res = await fetch(`${this.config.appUrl}${path}`, {
      ...options,
      headers: { ...this.headers, ...options?.headers },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(`API error (${res.status}): ${JSON.stringify(err)}`);
    }
    return res.json();
  }

  // Rules
  async listRules(objectType?: string) {
    const params = objectType ? `?object=${objectType}` : "";
    return this.request(`/api/rules${params}`);
  }
  async getRule(id: string) {
    return this.request(`/api/rules/${id}`);
  }
  async createRule(data: Record<string, unknown>) {
    return this.request("/api/rules", { method: "POST", body: JSON.stringify(data) });
  }
  async updateRule(id: string, data: Record<string, unknown>) {
    return this.request(`/api/rules/${id}`, { method: "PUT", body: JSON.stringify(data) });
  }
  async deleteRule(id: string) {
    return this.request(`/api/rules/${id}`, { method: "DELETE" });
  }
  async cloneRule(id: string, data?: Record<string, unknown>) {
    return this.request(`/api/rules/${id}/clone`, { method: "POST", body: JSON.stringify(data || {}) });
  }
  async reorderRules(ruleIds: string[]) {
    return this.request("/api/rules/reorder", { method: "POST", body: JSON.stringify({ ruleIds }) });
  }
  async testRule(id: string, fields: Record<string, unknown>) {
    return this.request(`/api/rules/${id}/test`, { method: "POST", body: JSON.stringify({ fields }) });
  }
  async runScheduledRule(id: string) {
    return this.request(`/api/rules/${id}/run`, { method: "POST" });
  }

  // Teams
  async listTeams() {
    return this.request("/api/teams");
  }
  async getTeam(id: string) {
    return this.request(`/api/teams/${id}`);
  }
  async createTeam(data: Record<string, unknown>) {
    return this.request("/api/teams", { method: "POST", body: JSON.stringify(data) });
  }
  async updateTeam(id: string, data: Record<string, unknown>) {
    return this.request(`/api/teams/${id}`, { method: "PUT", body: JSON.stringify(data) });
  }
  async deleteTeam(id: string) {
    return this.request(`/api/teams/${id}`, { method: "DELETE" });
  }

  // Team members
  async addTeamMember(teamId: string, data: Record<string, unknown>) {
    return this.request(`/api/teams/${teamId}/members`, { method: "POST", body: JSON.stringify(data) });
  }
  async removeTeamMember(teamId: string, userId: string) {
    return this.request(`/api/teams/${teamId}/members/${userId}`, { method: "DELETE" });
  }
  async toggleTeamMember(teamId: string, userId: string, data: Record<string, unknown>) {
    return this.request(`/api/teams/${teamId}/members/${userId}`, { method: "PATCH", body: JSON.stringify(data) });
  }
  async updateTeamWeights(teamId: string, weights: Array<{ userId: string; weight: number }>) {
    return this.request(`/api/teams/${teamId}/weights`, { method: "PUT", body: JSON.stringify({ weights }) });
  }
  async resetTeamPointer(teamId: string) {
    return this.request(`/api/teams/${teamId}/reset-pointer`, { method: "POST" });
  }

  // Users
  async listUsers(query?: string, licensed?: string) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (licensed) params.set("licensed", licensed);
    const qs = params.toString();
    return this.request(`/api/users${qs ? `?${qs}` : ""}`);
  }
  async syncUsers() {
    return this.request("/api/users", { method: "POST" });
  }
  async licenseUser(userId: string) {
    return this.request(`/api/users/${userId}/license`, { method: "POST" });
  }
  async delicenseUser(userId: string) {
    return this.request(`/api/users/${userId}/de-license`, { method: "POST" });
  }

  // Fields
  async listFields(objectType?: string) {
    const params = objectType ? `?objectType=${objectType}` : "";
    return this.request(`/api/fields${params}`);
  }
  async syncFields() {
    return this.request("/api/fields/sync", { method: "POST" });
  }

  // Queues
  async listQueues() {
    return this.request("/api/queues");
  }
  async syncQueues() {
    return this.request("/api/queues/sync", { method: "POST" });
  }

  // Routing mode
  async getRoutingMode() {
    return this.request("/api/routing-mode");
  }
  async setRoutingMode(mode: string) {
    return this.request("/api/routing-mode", { method: "PUT", body: JSON.stringify({ mode }) });
  }

  // Bulk user operations
  async bulkLicenseUsers(userIds: string[]) {
    return this.request("/api/users/bulk-license", { method: "POST", body: JSON.stringify({ userIds }) });
  }
  async licenseUsersByRole(role: string) {
    return this.request("/api/users/license-by-role", { method: "POST", body: JSON.stringify({ role }) });
  }
  async licenseUsersByProfile(profile: string) {
    return this.request("/api/users/license-by-profile", { method: "POST", body: JSON.stringify({ profile }) });
  }

  // SFDC status
  async getSfdcStatus() {
    return this.request("/api/integrations/salesforce/status");
  }

  // Bulk runs
  async getBulkRunStatus(runId: string) {
    return this.request(`/api/bulk-run/${runId}/status`);
  }
  async cancelBulkRun(runId: string) {
    return this.request(`/api/bulk-run/${runId}/cancel`, { method: "POST" });
  }

  // License
  async getLicenseInfo() {
    return this.request("/api/license");
  }

  // Analytics
  async getAnalyticsOverview(from?: string, to?: string) {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return this.request(`/api/analytics/overview${qs ? `?${qs}` : ""}`);
  }
  async getAnalyticsRules(from?: string, to?: string) {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return this.request(`/api/analytics/rules${qs ? `?${qs}` : ""}`);
  }
  async getAnalyticsTeams(from?: string, to?: string) {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return this.request(`/api/analytics/teams${qs ? `?${qs}` : ""}`);
  }

  // Logs
  async getRoutingLogs(filters?: Record<string, string | number>) {
    const params = new URLSearchParams();
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
    }
    const qs = params.toString();
    return this.request(`/api/routing-logs${qs ? `?${qs}` : ""}`);
  }
  async getRecordJourney(recordId: string) {
    return this.request(`/api/routing-logs/journey/${recordId}`);
  }
  async getRoutingStats() {
    return this.request("/api/routing-logs/stats");
  }
  async getFailedLogs(page?: number, limit?: number) {
    const params = new URLSearchParams();
    if (page) params.set("page", String(page));
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    return this.request(`/api/routing-logs/failed${qs ? `?${qs}` : ""}`);
  }
  async retryRouting(logId: string) {
    return this.request(`/api/routing-logs/${logId}/retry`, { method: "POST" });
  }
  async retryAllFailed() {
    return this.request("/api/routing-logs/retry-all", { method: "POST" });
  }
  async dismissLog(logId: string) {
    return this.request(`/api/routing-logs/${logId}/dismiss`, { method: "POST" });
  }

  // Flows
  async listFlows() {
    return this.request("/api/flows");
  }
  async getFlow(objectType: string) {
    return this.request(`/api/flows/${objectType}`);
  }
  async testFlow(objectType: string, fields: Record<string, unknown>) {
    return this.request(`/api/flows/${objectType}/test`, { method: "POST", body: JSON.stringify({ fields }) });
  }

  // Audit logs
  async getAuditLogs(filters?: Record<string, string | number>) {
    const params = new URLSearchParams();
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null) params.set(k, String(v));
      }
    }
    const qs = params.toString();
    return this.request(`/api/audit-logs${qs ? `?${qs}` : ""}`);
  }

  // User stats
  async getUserStats() {
    return this.request("/api/users/stats");
  }
}
