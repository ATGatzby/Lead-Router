import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getAnalyticsTeamsTool = {
  name: "get_analytics_teams",
  description: "Get per-team analytics — assignment count and distribution per team member.",
  inputSchema: {
    type: "object" as const,
    properties: {
      from: {
        type: "string",
        description: "Start date (ISO string, e.g. 2026-01-01)",
      },
      to: {
        type: "string",
        description: "End date (ISO string, e.g. 2026-03-18)",
      },
    },
  },
};

export async function handleGetAnalyticsTeams(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const data = await web.getAnalyticsTeams(args?.from, args?.to);
  const teams = data.teams || data;
  logger.log({ tool: "get_analytics_teams", action: "read", input: args, durationMs: Date.now() - start });

  if (!Array.isArray(teams) || !teams.length) return successResponse("No per-team analytics found.");

  const text = teams
    .map((t: any, i: number) => {
      let line = `${i + 1}. ${t.name ?? t.teamId}\n   Assignments: ${t.assignmentCount ?? "—"}`;
      if (Array.isArray(t.members) && t.members.length) {
        const memberLines = t.members
          .map((m: any) => `     • ${m.name}: ${m.assignmentCount ?? 0}`)
          .join("\n");
        line += `\n${memberLines}`;
      }
      return line;
    })
    .join("\n\n");

  return successResponse(text);
}
