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
  const data = await web.getAnalyticsTeams(args?.from, args?.to) as any;
  const teams = data.teams || data;
  logger.log({ tool: "get_analytics_teams", action: "read", input: args, durationMs: Date.now() - start });

  if (!Array.isArray(teams) || !teams.length) return successResponse("No per-team analytics found.");

  const text = teams
    .map((t: any, i: number) => {
      let line = `${i + 1}. ${t.teamName ?? t.name ?? t.teamId}`;
      line += `\n   Total: ${t.total ?? "—"} | Success: ${t.success ?? "—"}`;
      if (t.fairnessScore != null) line += ` | Fairness Score: ${t.fairnessScore}`;
      if (Array.isArray(t.members) && t.members.length) {
        const memberLines = t.members
          .map((m: any) => `     • ${m.assigneeName || m.name}: target ${m.targetPercent ?? "—"}% / actual ${m.actualPercent ?? "—"}%`)
          .join("\n");
        line += `\n${memberLines}`;
      }
      return line;
    })
    .join("\n\n");

  return successResponse(text);
}
