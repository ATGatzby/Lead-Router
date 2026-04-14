import { describe, it, expect, vi } from "vitest";
import { mockWebClient, mockLogger } from "../helpers";
import { handleGetAnalyticsOverview } from "../../src/tools/get-analytics-overview.js";
import { handleGetAnalyticsRules } from "../../src/tools/get-analytics-rules.js";
import { handleGetAnalyticsTeams } from "../../src/tools/get-analytics-teams.js";

// ---------------------------------------------------------------------------
// get_analytics_overview
// ---------------------------------------------------------------------------
describe("handleGetAnalyticsOverview", () => {
  it("returns overview stats", async () => {
    const web = mockWebClient({
      getAnalyticsOverview: vi.fn().mockResolvedValue({
        totalRouted: 500,
        statusBreakdown: { success: 475, failed: 5, unmatched: 20, merged: 0 },
        successRate: 95,
        avgSpeedSeconds: 0.12,
        conversionRate: 10,
      }),
    });
    const res = await handleGetAnalyticsOverview(web, mockLogger(), {});
    expect(res.content[0].text).toContain("500");
    expect(res.content[0].text).toContain("95%");
  });

  it("handles missing values with dashes", async () => {
    const web = mockWebClient({
      getAnalyticsOverview: vi.fn().mockResolvedValue({}),
    });
    const res = await handleGetAnalyticsOverview(web, mockLogger(), {});
    expect(res.content[0].text).toContain("—");
  });
});

// ---------------------------------------------------------------------------
// get_analytics_rules
// ---------------------------------------------------------------------------
describe("handleGetAnalyticsRules", () => {
  it("returns per-rule stats", async () => {
    const web = mockWebClient({
      getAnalyticsRules: vi.fn().mockResolvedValue({
        rules: [{ ruleName: "Enterprise", total: 200, success: 185, failed: 15, unmatched: 0, successRate: 92.5, avgDurationMs: 50, paths: [] }],
      }),
    });
    const res = await handleGetAnalyticsRules(web, mockLogger(), {});
    expect(res.content[0].text).toContain("Enterprise");
    expect(res.content[0].text).toContain("200");
    expect(res.content[0].text).toContain("92.5%");
  });

  it("returns empty message when no rules", async () => {
    const web = mockWebClient({
      getAnalyticsRules: vi.fn().mockResolvedValue({ rules: [] }),
    });
    const res = await handleGetAnalyticsRules(web, mockLogger(), {});
    expect(res.content[0].text).toContain("No per-rule analytics");
  });
});

// ---------------------------------------------------------------------------
// get_analytics_teams
// ---------------------------------------------------------------------------
describe("handleGetAnalyticsTeams", () => {
  it("returns per-team stats with members", async () => {
    const web = mockWebClient({
      getAnalyticsTeams: vi.fn().mockResolvedValue({
        teams: [{
          teamName: "Sales",
          total: 100,
          success: 100,
          fairnessScore: 100,
          members: [{ assigneeName: "Alice", total: 50, targetPercent: 50, actualPercent: 50 }, { assigneeName: "Bob", total: 50, targetPercent: 50, actualPercent: 50 }],
        }],
      }),
    });
    const res = await handleGetAnalyticsTeams(web, mockLogger(), {});
    expect(res.content[0].text).toContain("Sales");
    expect(res.content[0].text).toContain("Alice");
    expect(res.content[0].text).toContain("Bob");
  });

  it("returns empty message when no teams", async () => {
    const web = mockWebClient({
      getAnalyticsTeams: vi.fn().mockResolvedValue({ teams: [] }),
    });
    const res = await handleGetAnalyticsTeams(web, mockLogger(), {});
    expect(res.content[0].text).toContain("No per-team analytics");
  });
});
