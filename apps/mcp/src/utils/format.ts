export function formatRulesSummary(rules: any[]): string {
  if (!rules.length) return "No routing rules found.";
  return rules
    .map((r: any, i: number) => {
      const conditions = r.conditions?.length || 0;
      const branches = r.branches?.length || 0;
      let assignment = "Not configured";
      if (r.assigneeTeamName) assignment = `Round-Robin → ${r.assigneeTeamName}`;
      else if (r.assigneeUserName) assignment = `User → ${r.assigneeUserName}`;
      else if (r.assigneeQueueName) assignment = `Queue → ${r.assigneeQueueName}`;
      else if (branches > 0) assignment = `${branches} branch(es)`;
      return `${i + 1}. ${r.name} (Priority ${r.priority}) — ${r.objectType}, on ${r.triggerEvent}\n   ID: ${r.id}\n   Status: ${r.status} | Conditions: ${conditions} | Assignment: ${assignment}${r.isDryRun ? " [DRY RUN]" : ""}`;
    })
    .join("\n\n");
}

export function formatTeamsSummary(teams: any[]): string {
  if (!teams.length) return "No teams found.";
  return teams
    .map((t: any, i: number) =>
      `${i + 1}. ${t.name} — ${t.distributionType}\n   ID: ${t.id}\n   Members: ${t.activeCount} active / ${t.memberCount} total | Assigned: ${t.totalAssigned}`
    )
    .join("\n\n");
}

export function formatUsersSummary(users: any[]): string {
  if (!users.length) return "No users found.";
  return users
    .map((u: any) =>
      `• ${u.name} (${u.email}) — ID: ${u.id}${u.role ? ` | ${u.role}` : ""}${u.isLicensed ? " [Licensed]" : ""}${u.teamMemberships?.length ? ` | Teams: ${u.teamMemberships.map((tm: any) => tm.team.name).join(", ")}` : ""}`
    )
    .join("\n");
}

export function formatLogsSummary(logs: any[]): string {
  if (!logs.length) return "No routing logs found.";
  return logs
    .map((l: any) =>
      `• ${l.crmRecordId} — ${l.status}${l.ruleName ? ` via ${l.ruleName}` : ""}${l.assigneeName ? ` → ${l.assigneeName}` : ""} (${new Date(l.createdAt).toLocaleString()})`
    )
    .join("\n");
}
