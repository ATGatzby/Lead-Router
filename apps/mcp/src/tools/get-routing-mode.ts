import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getRoutingModeTool = {
  name: "get_routing_mode",
  description: "Get the current routing mode — either 'rules' (priority-based rules) or 'flows' (decision tree flows).",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleGetRoutingMode(web: WebClient, logger: Logger) {
  const start = Date.now();
  const result = await web.getRoutingMode();
  logger.log({ tool: "get_routing_mode", action: "read", result, durationMs: Date.now() - start });

  const mode = result.mode || result;
  return successResponse(`Current routing mode: ${mode}`);
}
