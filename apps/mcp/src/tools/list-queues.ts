import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const listQueuesTool = {
  name: "list_queues",
  description: "List Salesforce queues synced for routing assignment.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleListQueues(web: WebClient, logger: Logger) {
  const start = Date.now();
  const data = await web.listQueues();
  const queues = data.queues || data;
  logger.log({ tool: "list_queues", action: "read", durationMs: Date.now() - start });

  if (!Array.isArray(queues) || queues.length === 0) {
    return successResponse("No queues found. Run sync_queues to sync queues from Salesforce.");
  }

  const lines = [`${queues.length} queue(s) synced:`];
  for (const q of queues) {
    lines.push(`  ${q.name} — ${q.id}${q.sObjectType ? ` (${q.sObjectType})` : ""}`);
  }

  return successResponse(lines.join("\n"));
}
