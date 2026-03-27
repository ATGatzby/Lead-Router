import type { WebClient } from "../clients/web-client.js";
import { formatTeamsSummary } from "../utils/format.js";

export const teamsResource = {
  uri: "lead-routing://teams",
  name: "Routing Teams",
  description: "Current routing teams and their member counts",
  mimeType: "text/plain",
};

export async function handleTeamsResource(web: WebClient) {
  const data = await web.listTeams();
  const teams = data.teams || data;
  return {
    contents: [{
      uri: "lead-routing://teams",
      mimeType: "text/plain",
      text: formatTeamsSummary(teams),
    }],
  };
}
