import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const exportReportCompositeTool = {
  name: "export_report",
  description:
    "Generate and export a routing report (CSV or JSON). " +
    "Combines analytics data across rules, teams, and routing logs into a single export. " +
    "Supports filtering by date range, object type, and report type.",
  inputSchema: {
    type: "object" as const,
    properties: {
      reportType: {
        type: "string",
        enum: ["routing_summary", "team_performance", "rule_effectiveness", "failure_analysis"],
        description: "Type of report to generate",
      },
      format: {
        type: "string",
        enum: ["csv", "json"],
        description: "Export format. Defaults to json.",
      },
      from: { type: "string", description: "ISO date — start of report period" },
      to: { type: "string", description: "ISO date — end of report period" },
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT", "COMPANY", "DEAL"],
        description: "Filter by object type",
      },
    },
    required: ["reportType"],
  },
};

export async function handleExportReportComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1ExportReport(args);
    const durationMs = Date.now() - start;
    logger.log({ tool: "export_report", action: "execute", input: args, result, durationMs });

    if (!result.success) {
      return errorResponse(`${result.error?.message}\n\nRemediation: ${result.error?.remediation}`);
    }

    const lines = [
      ...result.actions_taken.map((a: string) => `✓ ${a}`),
    ];
    if (result.data) {
      lines.push("", typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2));
    }
    if (result.warnings?.length) {
      lines.push("", "Warnings:", ...result.warnings.map((w: string) => `⚠ ${w}`));
    }
    if (result.next_actions?.length) {
      lines.push("", "Suggested next:", ...result.next_actions.map((n: any) => `→ ${n.action}: ${n.reason}`));
    }
    return successResponse(lines.join("\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.log({ tool: "export_report", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (get_analytics_overview, get_routing_logs) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
