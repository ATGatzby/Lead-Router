import type { EngineClient } from "../clients/engine-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const checkHealthTool = {
  name: "check_health",
  description: "Check if the lead routing engine is healthy and responding",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function handleCheckHealth(engine: EngineClient, logger: Logger) {
  const start = Date.now();
  const result = await engine.healthCheck();
  logger.log({ tool: "check_health", action: "read", result, durationMs: Date.now() - start });
  return successResponse(`Engine is healthy.\nStatus: ${result.status}\nTimestamp: ${result.ts ?? new Date().toISOString()}`);
}
