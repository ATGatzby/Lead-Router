import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const listFlowsTool = {
  name: "list_flows",
  description: "List all routing flows (decision trees).",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleListFlows(web: WebClient, logger: Logger) {
  const start = Date.now();
  const data = await web.listFlows();
  const flows = data.flows || data;
  logger.log({ tool: "list_flows", action: "read", durationMs: Date.now() - start });

  if (!Array.isArray(flows) || !flows.length) return successResponse("No routing flows found.");

  const text = flows
    .map((f: any, i: number) =>
      `${i + 1}. ${f.name ?? f.objectType}\n   Object Type: ${f.objectType} | Nodes: ${f.nodeCount ?? "—"} | Status: ${f.status ?? "—"}\n   ID: ${f.id}`
    )
    .join("\n\n");

  return successResponse(text);
}
