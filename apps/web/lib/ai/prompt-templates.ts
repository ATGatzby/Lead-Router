export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  context: string | null; // null = global
  category: string;
}

export const BUILT_IN_TEMPLATES: PromptTemplate[] = [
  {
    id: "health-check",
    name: "Routing Health Check",
    description: "Comprehensive audit of rules, teams, and failure rates",
    content:
      "Give me a complete routing health check:\n1. Check all rules for failure rates above 5%\n2. Verify team workload is balanced within 10%\n3. Identify any rules that haven't routed anything in 7 days\n4. Summarize overall routing volume trends\n5. Flag any anomalies or issues that need attention",
    context: null,
    category: "Analytics",
  },
  {
    id: "licensing-review",
    name: "Monthly Licensing Review",
    description: "Check seat utilization, identify waste",
    content:
      "Review our license utilization:\n1. How many seats are used vs available?\n2. Are there any licensed users who haven't been routed to in 30 days?\n3. Are there unlicensed users who should have licenses based on their role?\n4. Show me a breakdown of licensed users by department",
    context: "license-users",
    category: "Licensing",
  },
  {
    id: "team-rebalance",
    name: "Team Rebalancing",
    description: "Analyze workload distribution, suggest weight changes",
    content:
      "Analyze team workload distribution:\n1. Show me assignment counts per team member for all teams\n2. Identify any team where the workload variance is more than 20%\n3. Suggest weight adjustments to balance the load\n4. Check if any paused members should be reactivated",
    context: "teams",
    category: "Teams",
  },
  {
    id: "new-hire",
    name: "New Hire Onboarding",
    description: "License a user and add to appropriate teams",
    content:
      "I need to onboard a new hire. Please:\n1. Show me all unlicensed users\n2. I'll tell you which one to license\n3. Then suggest which teams they should join based on their role\n4. Add them to the appropriate teams",
    context: null,
    category: "Operations",
  },
  {
    id: "rep-offboarding",
    name: "Rep Offboarding",
    description: "De-license, pause memberships, check rule impacts",
    content:
      "I need to offboard a rep. Please:\n1. Show me all licensed users\n2. I'll tell you which one to offboard\n3. Check which teams they're on and what rules reference those teams\n4. Pause their team memberships\n5. De-license them\n6. Confirm no routing gaps were created",
    context: null,
    category: "Operations",
  },
  {
    id: "performance-dive",
    name: "Performance Deep Dive",
    description: "Conversion rates by rule, team, and branch",
    content:
      "Give me a deep performance analysis:\n1. Show conversion rates by routing rule\n2. Break down performance by branch/path within the top rule\n3. Compare team assignment success rates\n4. Show the trend over the last 30 days\n5. Identify the best and worst performing paths",
    context: null,
    category: "Analytics",
  },
  {
    id: "rule-optimization",
    name: "Rule Optimization",
    description: "Identify underperformers, suggest improvements",
    content:
      "Help me optimize my routing rules:\n1. Which rules have the highest failure rates?\n2. Are there any rules that overlap in their conditions?\n3. Which rules are in dry-run mode and should be activated?\n4. Suggest any condition improvements based on the routing data\n5. Show me rules ordered by volume with their success rates",
    context: "routing-rules",
    category: "Optimization",
  },
  {
    id: "compliance-audit",
    name: "Compliance Audit",
    description: "Audit log review for a specific period",
    content:
      "Run a compliance audit for the last 30 days:\n1. Show all configuration changes (rules created, modified, deleted)\n2. Show all team membership changes\n3. Show all licensing changes\n4. Identify any changes made by AI vs manual\n5. Flag any unusual patterns (bulk changes, after-hours modifications)",
    context: null,
    category: "Compliance",
  },
];
