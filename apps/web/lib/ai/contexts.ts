export type AgentContext = "license-users" | "teams" | "routing-rules" | "global";

// Which read tools are relevant to each context
export const CONTEXT_READ_TOOLS: Record<AgentContext, string[]> = {
  "license-users": ["list_users", "list_teams", "get_org_settings", "query_audit_logs", "list_fields"],
  "teams": ["list_teams", "list_users", "list_queues", "get_team_workload", "query_audit_logs", "get_org_settings"],
  "routing-rules": ["list_rules", "explain_rule", "list_fields", "list_teams", "list_users", "list_queues", "get_rule_performance", "get_branch_performance", "query_audit_logs"],
  "global": [], // empty = include ALL tools
};

// Context-specific system prompt sections
export const CONTEXT_PROMPTS: Record<AgentContext, string> = {
  "license-users": `You are focused on user license management. You can:
- View all Salesforce users synced to this org
- License and de-license users (individually or in bulk by role/department)
- Check seat usage and availability
- See which teams users belong to

When licensing users, always check seat availability first. When de-licensing, warn about team membership impacts.`,

  "teams": `You are focused on round-robin team management. You can:
- Create, update, and delete teams
- Add and remove team members
- Set distribution type (round-robin or weighted)
- Update member weights
- Pause and activate members

When creating teams, suggest appropriate members based on role or department. When adjusting weights, explain the distribution impact.`,

  "routing-rules": `You are focused on routing rule configuration. You can:
- Create rules with branches, conditions, and assignments
- Toggle rules active/inactive
- Delete rules
- Explain existing rule logic

Rules have branches with conditions (field + operator + value). Each branch assigns to a USER, ROUND_ROBIN team, or QUEUE.
Available Salesforce fields will be provided by the list_fields tool. Always verify field names exist before using them in conditions.

Operators by field type:
- TEXT: equals, not_equals, contains, not_contains, starts_with, is_blank, is_not_blank
- NUMBER: equals, not_equals, gt, lt, gte, lte, is_blank, is_not_blank
- PICKLIST: equals, not_equals, includes, excludes, is_blank, is_not_blank
- BOOLEAN: is_true, is_false
- DATE/DATETIME: equals, before, after, within_last, is_blank, is_not_blank`,

  "global": `You are the full-featured routing assistant with access to ALL capabilities:
analytics, user licensing, team management, and rule configuration.
Determine from the user's request which domain they're working in and use the appropriate tools.`,
};

// Pre-fetch lightweight context data for injection into system prompt
export async function getContextData(orgId: string, context: AgentContext): Promise<string> {
  // Import prisma inside the function to avoid circular deps
  const { prisma } = await import("@lead-routing/db");

  switch (context) {
    case "license-users": {
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: orgId },
        select: { seatsPurchased: true, seatsUsed: true },
      });
      const userCount = await prisma.user.count({ where: { orgId, isActive: true } });
      const licensedCount = await prisma.user.count({ where: { orgId, isActive: true, isLicensed: true } });
      return `\nCurrent state: ${org.seatsUsed}/${org.seatsPurchased} seats used. ${licensedCount} licensed users out of ${userCount} total active users.`;
    }
    case "teams": {
      const teams = await prisma.roundRobinTeam.findMany({
        where: { orgId },
        select: { id: true, name: true, distributionType: true, _count: { select: { members: true } } },
      });
      if (teams.length === 0) return "\nNo teams exist yet.";
      return `\nCurrent teams:\n${teams.map(t => `- "${t.name}" (${t.distributionType}, ${t._count.members} members, id: ${t.id})`).join("\n")}`;
    }
    case "routing-rules": {
      const rules = await prisma.routingRule.findMany({
        where: { orgId },
        select: { id: true, name: true, status: true, objectType: true, triggerEvent: true },
        orderBy: { priority: "asc" },
      });
      if (rules.length === 0) return "\nNo routing rules exist yet.";
      return `\nCurrent rules:\n${rules.map(r => `- "${r.name}" [${r.status}] (${r.objectType}, ${r.triggerEvent}, id: ${r.id})`).join("\n")}`;
    }
    case "global": {
      const [org, ruleCount, teamCount, userCount] = await Promise.all([
        prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { seatsPurchased: true, seatsUsed: true } }),
        prisma.routingRule.count({ where: { orgId } }),
        prisma.roundRobinTeam.count({ where: { orgId } }),
        prisma.user.count({ where: { orgId, isActive: true } }),
      ]);
      return `\nOrg snapshot: ${org.seatsUsed}/${org.seatsPurchased} seats, ${ruleCount} rules, ${teamCount} teams, ${userCount} users.`;
    }
    default:
      return "";
  }
}
