import type { WebClient } from "../clients/web-client.js";
import { formatRulesSummary } from "../utils/format.js";

export const rulesResource = {
  uri: "lead-routing://rules",
  name: "Routing Rules",
  description: "Current active routing rules and their configurations",
  mimeType: "text/plain",
};

export async function handleRulesResource(web: WebClient) {
  const data = await web.listRules();
  const rules = data.rules || data;
  return {
    contents: [{
      uri: "lead-routing://rules",
      mimeType: "text/plain",
      text: formatRulesSummary(rules),
    }],
  };
}
