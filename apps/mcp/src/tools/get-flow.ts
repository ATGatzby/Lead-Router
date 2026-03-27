import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getFlowTool = {
  name: "get_flow",
  description: "Get the routing flow (decision tree) for a specific object type.",
  inputSchema: {
    type: "object" as const,
    properties: {
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT"],
        description: "Salesforce object type",
      },
    },
    required: ["objectType"],
  },
};

export async function handleGetFlow(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const data = await web.getFlow(args.objectType);
  logger.log({ tool: "get_flow", action: "read", input: args, durationMs: Date.now() - start });

  const lines = [
    `Flow: ${data.name ?? data.objectType}`,
    `  Object Type: ${data.objectType}`,
    `  Status: ${data.status ?? "—"}`,
    `  ID: ${data.id ?? "—"}`,
  ];

  if (Array.isArray(data.nodes) && data.nodes.length) {
    lines.push(`  Nodes: ${data.nodes.length}`);
    for (const node of data.nodes) {
      lines.push(`    • ${node.type ?? "node"}: ${node.label ?? node.name ?? node.id}${node.ruleId ? ` (Rule: ${node.ruleId})` : ""}`);
    }
  }

  return successResponse(lines.join("\n"));
}
