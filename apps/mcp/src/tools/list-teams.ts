import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";
import { formatTeamsSummary } from "../utils/format.js";

export const listTeamsTool = {
  name: "list_teams",
  description: "List all routing teams and their member counts",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleListTeams(web: WebClient, logger: Logger) {
  const start = Date.now();
  const data = await web.listTeams();
  const teams = data.teams || data;
  logger.log({ tool: "list_teams", action: "read", durationMs: Date.now() - start });
  return successResponse(formatTeamsSummary(teams));
}
