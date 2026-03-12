import {
  queryRoutingLogs,
  getRulePerformance,
  getTeamWorkload,
  getConversionMetrics,
  getTrendData,
  listRules,
  getAssigneeStats,
  explainRule,
  getRoutingTimeline,
} from "./queries";

// Claude tool format
export const TOOLS = [
  {
    name: "query_routing_logs",
    description: "Search and filter routing event logs. Use this to find specific routing events, check recent failures, or look up what happened to specific leads/contacts. Returns individual log entries with status, assignee, rule matched, duration, and error messages.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["SUCCESS", "FAILED", "UNMATCHED", "RETRY", "MERGED"], description: "Filter by routing outcome status" },
        ruleId: { type: "string", description: "Filter by specific routing rule ID" },
        assigneeId: { type: "string", description: "Filter by SFDC user/queue ID who received the assignment" },
        objectType: { type: "string", enum: ["LEAD", "CONTACT", "ACCOUNT"], description: "Filter by Salesforce object type" },
        dateFrom: { type: "string", description: "Start date (ISO format, e.g. 2026-03-01)" },
        dateTo: { type: "string", description: "End date (ISO format, e.g. 2026-03-12)" },
        limit: { type: "number", description: "Max results to return (default 50, max 200)" },
      },
    },
  },
  {
    name: "get_rule_performance",
    description: "Get aggregated performance metrics for all routing rules — success count, failure count, unmatched count, merged count, total volume, and average routing duration. Use this to compare rules, find which rule has the highest failure rate, or see overall routing health.",
    input_schema: {
      type: "object" as const,
      properties: {
        dateFrom: { type: "string", description: "Start date (ISO format)" },
        dateTo: { type: "string", description: "End date (ISO format)" },
      },
    },
  },
  {
    name: "get_team_workload",
    description: "Get assignment counts per team member across round-robin teams. Use this to check if workload is balanced, find who has the most/least assignments, or analyze team capacity.",
    input_schema: {
      type: "object" as const,
      properties: {
        dateFrom: { type: "string", description: "Start date (ISO format)" },
        dateTo: { type: "string", description: "End date (ISO format)" },
      },
    },
  },
  {
    name: "get_conversion_metrics",
    description: "Get lead-to-opportunity conversion metrics grouped by routing rule. Shows conversion rate and total pipeline revenue generated. Use this to find which routing paths generate the most revenue or have the best conversion rates.",
    input_schema: {
      type: "object" as const,
      properties: {
        dateFrom: { type: "string", description: "Start date (ISO format)" },
        dateTo: { type: "string", description: "End date (ISO format)" },
      },
    },
  },
  {
    name: "get_trend_data",
    description: "Get daily aggregated routing metrics over time. Returns daily counts of success, failed, unmatched, merged events plus average duration. Use this to spot trends, detect anomalies, or show volume changes over time. Can filter to a specific rule.",
    input_schema: {
      type: "object" as const,
      properties: {
        ruleId: { type: "string", description: "Optional: filter to a specific rule ID" },
        dateFrom: { type: "string", description: "Start date (ISO format)" },
        dateTo: { type: "string", description: "End date (ISO format)" },
      },
    },
  },
  {
    name: "list_rules",
    description: "List all routing rules in the organization with their status, priority, object type, trigger event, and branch/condition counts. Use this to answer 'what rules do I have', 'which rules are active', 'show me my routing configuration'. Can filter by status (ACTIVE/INACTIVE) and object type.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["ACTIVE", "INACTIVE"], description: "Filter by rule status" },
        objectType: { type: "string", enum: ["LEAD", "CONTACT", "ACCOUNT"], description: "Filter by Salesforce object type" },
      },
    },
  },
  {
    name: "get_assignee_stats",
    description: "Get assignment counts per individual assignee (user or queue) regardless of team. Use this when the user asks 'who has received the most assignments', 'show assignments by rep', or wants to see individual workload across all rules. Unlike get_team_workload which groups by team, this shows all assignees.",
    input_schema: {
      type: "object" as const,
      properties: {
        dateFrom: { type: "string", description: "Start date (ISO format). Defaults to all time if omitted." },
        dateTo: { type: "string", description: "End date (ISO format)" },
      },
    },
  },
  {
    name: "explain_rule",
    description: "Get the full configuration of a routing rule including all branches, conditions, match config, and trigger conditions. Use this when the user asks what a rule does, how it works, or wants to understand its logic.",
    input_schema: {
      type: "object" as const,
      properties: {
        ruleId: { type: "string", description: "The routing rule ID to explain" },
      },
      required: ["ruleId"],
    },
  },
  {
    name: "get_routing_timeline",
    description: "Get the routing history for a specific Salesforce record (Lead, Contact, or Account). Shows all routing events in reverse chronological order. Use this when the user asks 'what happened to lead X' or wants to trace a specific record's routing journey.",
    input_schema: {
      type: "object" as const,
      properties: {
        sfdcRecordId: { type: "string", description: "The Salesforce record ID (e.g. 00Q...)" },
      },
      required: ["sfdcRecordId"],
    },
  },
];

// Convert Claude tools to OpenAI function calling format
export function toolsToOpenAI(tools: typeof TOOLS) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// Execute a tool by name with given arguments, scoped to orgId
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  orgId: string
): Promise<unknown> {
  switch (toolName) {
    case "query_routing_logs":
      return queryRoutingLogs(orgId, args as any);
    case "get_rule_performance":
      return getRulePerformance(orgId, args as any);
    case "get_team_workload":
      return getTeamWorkload(orgId, args as any);
    case "get_conversion_metrics":
      return getConversionMetrics(orgId, args as any);
    case "get_trend_data":
      return getTrendData(orgId, args as any);
    case "list_rules":
      return listRules(orgId, args as any);
    case "get_assignee_stats":
      return getAssigneeStats(orgId, args as any);
    case "explain_rule":
      return explainRule(orgId, args.ruleId as string);
    case "get_routing_timeline":
      return getRoutingTimeline(orgId, args.sfdcRecordId as string);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
