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
  listTeams,
  listUsers,
  queryAuditLogs,
  listQueues,
  queryCompanyAliases,
  listFields,
  getOrgSettings,
  listAppUsers,
  listInvites,
  getBillingInfo,
  listSessions,
  getBranchPerformance,
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
        assigneeName: { type: "string", description: "Filter by assignee name (case-insensitive contains match)" },
        objectType: { type: "string", enum: ["LEAD", "CONTACT", "ACCOUNT"], description: "Filter by Salesforce object type" },
        dateFrom: { type: "string", description: "Start date (ISO format, e.g. 2026-03-01)" },
        dateTo: { type: "string", description: "End date (ISO format, e.g. 2026-03-12)" },
        pathLabel: { type: "string", description: "Filter by branch/path label (e.g. 'Enterprise', 'SMB')" },
        branchId: { type: "string", description: "Filter by specific branch ID" },
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
  {
    name: "list_teams",
    description: "List round-robin teams with their members, weights, and active/paused status. Use to check team configuration, member weights, who is paused, or current pointer position. Optionally filter to a single team for full detail.",
    input_schema: {
      type: "object" as const,
      properties: {
        teamId: { type: "string", description: "Optional: filter to a specific team ID for full detail" },
      },
    },
  },
  {
    name: "list_users",
    description: "List Salesforce users synced to the organization. Filter by licensed status, active status, department, or search by name/email. Use to find specific reps, check who is licensed, or see user details.",
    input_schema: {
      type: "object" as const,
      properties: {
        isLicensed: { type: "boolean", description: "Filter by licensed status" },
        isActive: { type: "boolean", description: "Filter by active status" },
        department: { type: "string", description: "Filter by department name" },
        search: { type: "string", description: "Search by name or email (case-insensitive)" },
        limit: { type: "number", description: "Max results (default 100)" },
      },
    },
  },
  {
    name: "query_audit_logs",
    description: "Search the audit trail for configuration changes — rule creates/edits/deletes, user licensing changes, team modifications, etc. Use to answer 'who changed this rule', 'what was modified recently', or 'show me the change history'.",
    input_schema: {
      type: "object" as const,
      properties: {
        action: { type: "string", description: "Filter by action type (e.g. RULE_CREATED, RULE_UPDATED, USER_LICENSED, TEAM_CREATED)" },
        entityType: { type: "string", description: "Filter by entity type (e.g. RoutingRule, User, RoundRobinTeam)" },
        entityId: { type: "string", description: "Filter by specific entity ID" },
        actorId: { type: "string", description: "Filter by who made the change (user ID)" },
        dateFrom: { type: "string", description: "Start date (ISO format)" },
        dateTo: { type: "string", description: "End date (ISO format)" },
        limit: { type: "number", description: "Max results (default 50, max 200)" },
      },
    },
  },
  {
    name: "list_queues",
    description: "List Salesforce queues synced to the organization. Shows queue name and SFDC queue ID. Use when the user asks about available queues for assignment.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "query_company_aliases",
    description: "View the company name matching cache — pairs of company names that have been compared for fuzzy/AI similarity. Shows whether they matched, confidence scores, source (AI/MANUAL/DICTIONARY), and how many times each pair was encountered.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Search for a company name (matches either side of the pair)" },
        isSimilar: { type: "boolean", description: "Filter by match result (true = similar, false = not similar)" },
        source: { type: "string", enum: ["AI", "MANUAL", "DICTIONARY"], description: "Filter by how the alias was determined" },
        limit: { type: "number", description: "Max results (default 50)" },
      },
    },
  },
  {
    name: "list_fields",
    description: "List available Salesforce fields for a given object type. Shows field API name, label, data type, and picklist values. Use when the user asks 'what fields can I use in conditions' or wants to understand available data.",
    input_schema: {
      type: "object" as const,
      properties: {
        objectType: { type: "string", enum: ["LEAD", "CONTACT", "ACCOUNT"], description: "Filter by Salesforce object type" },
      },
    },
  },
  {
    name: "get_org_settings",
    description: "Get organization configuration — plan tier, seat counts and usage, routing quota, Salesforce connection status, package deploy info, onboarding status, and AI provider config. Use when the user asks about their plan, quotas, connection status, or org settings.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_app_users",
    description: "List dashboard login users (not SFDC users). Shows email, name, role (ADMIN/MEMBER), and active status. Use when the user asks 'who has access to the dashboard' or about admin accounts.",
    input_schema: {
      type: "object" as const,
      properties: {
        role: { type: "string", enum: ["ADMIN", "MEMBER"], description: "Filter by role" },
        isActive: { type: "boolean", description: "Filter by active status" },
      },
    },
  },
  {
    name: "list_invites",
    description: "List pending, accepted, and expired invitations to the dashboard. Use when the user asks about outstanding invites or who has been invited.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: { type: "string", enum: ["pending", "accepted", "expired"], description: "Filter by invite status" },
      },
    },
  },
  {
    name: "get_billing_info",
    description: "Get billing and invoice details — entity name, GSTIN, address, and invoice email. Use when the user asks about their billing configuration.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_branch_performance",
    description: "Get per-branch/path performance breakdown within a specific routing rule. Shows success, failed, unmatched, and merged counts plus average duration for each branch. Use this when the user asks 'how are the branches performing', 'break down by path', or wants to compare branches within a rule.",
    input_schema: {
      type: "object" as const,
      properties: {
        ruleId: { type: "string", description: "The routing rule ID to break down by branch" },
        dateFrom: { type: "string", description: "Start date (ISO format)" },
        dateTo: { type: "string", description: "End date (ISO format)" },
      },
      required: ["ruleId"],
    },
  },
  {
    name: "list_sessions",
    description: "List login sessions — shows who is logged in, when they logged in, and when their session expires. Use when the user asks 'who is currently logged in' or about active sessions.",
    input_schema: {
      type: "object" as const,
      properties: {
        activeOnly: { type: "boolean", description: "Only show non-expired sessions (default true)" },
      },
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
    case "list_teams":
      return listTeams(orgId, args as any);
    case "list_users":
      return listUsers(orgId, args as any);
    case "query_audit_logs":
      return queryAuditLogs(orgId, args as any);
    case "list_queues":
      return listQueues(orgId);
    case "query_company_aliases":
      return queryCompanyAliases(orgId, args as any);
    case "list_fields":
      return listFields(orgId, args as any);
    case "get_org_settings":
      return getOrgSettings(orgId);
    case "list_app_users":
      return listAppUsers(orgId, args as any);
    case "list_invites":
      return listInvites(orgId, args as any);
    case "get_billing_info":
      return getBillingInfo(orgId);
    case "get_branch_performance":
      return getBranchPerformance(orgId, args as any);
    case "list_sessions":
      return listSessions(orgId, args as any);
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}
