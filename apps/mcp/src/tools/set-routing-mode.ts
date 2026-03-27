import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { previewResponse, successResponse } from "../utils/confirm.js";

export const setRoutingModeTool = {
  name: "set_routing_mode",
  description: "Switch the routing mode between rules (priority-based) and flows (decision tree). This changes how all incoming records are evaluated.",
  inputSchema: {
    type: "object" as const,
    properties: {
      mode: {
        type: "string",
        enum: ["rules", "flows"],
        description: "The routing mode to switch to",
      },
      confirm: {
        type: "boolean",
        description: "Set to true to execute. Defaults to false (preview only).",
      },
    },
    required: ["mode"],
  },
};

export async function handleSetRoutingMode(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const { mode, confirm } = args;

  if (!confirm) {
    const description = mode === "rules"
      ? "Priority-based rules — records are evaluated top-down against ordered rules."
      : "Decision tree flows — records are routed through visual flow diagrams.";
    logger.log({ tool: "set_routing_mode", action: "preview", input: { mode }, durationMs: Date.now() - start });
    return previewResponse(`Will switch routing mode to: ${mode}\n${description}`);
  }

  const result = await web.setRoutingMode(mode);
  logger.log({ tool: "set_routing_mode", action: "execute", input: { mode }, result, durationMs: Date.now() - start });
  return successResponse(`Routing mode switched to: ${mode}`);
}
