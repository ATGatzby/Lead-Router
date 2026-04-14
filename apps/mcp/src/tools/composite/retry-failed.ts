import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const retryFailedCompositeTool = {
  name: "retry_failed",
  description:
    "Retry failed routing assignments with optional filtering. " +
    "PREFERRED over retry_all_failed when you need control over which failures to retry. " +
    "Can filter by rule, time range, or error type.",
  inputSchema: {
    type: "object" as const,
    properties: {
      scope: {
        type: "string",
        enum: ["all", "rule", "time_range"],
        description: "Which failures to retry. 'all' retries everything.",
      },
      ruleId: { type: "string", description: "Only retry failures for this rule (when scope=rule)" },
      from: { type: "string", description: "ISO date — retry failures after this time (when scope=time_range)" },
      to: { type: "string", description: "ISO date — retry failures before this time (when scope=time_range)" },
      maxRetries: { type: "number", description: "Maximum number of records to retry" },
    },
  },
};

export async function handleRetryFailedComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1RetryFailed(args || {});
    const durationMs = Date.now() - start;
    logger.log({ tool: "retry_failed", action: "execute", input: args, result, durationMs });

    if (!result.success) {
      return errorResponse(`${result.error?.message}\n\nRemediation: ${result.error?.remediation}`);
    }

    const lines = [
      ...result.actions_taken.map((a: string) => `✓ ${a}`),
    ];
    if (result.warnings?.length) {
      lines.push("", "Warnings:", ...result.warnings.map((w: string) => `⚠ ${w}`));
    }
    if (result.next_actions?.length) {
      lines.push("", "Suggested next:", ...result.next_actions.map((n: any) => `→ ${n.action}: ${n.reason}`));
    }
    return successResponse(lines.join("\n"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.log({ tool: "retry_failed", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (retry_routing, retry_all_failed) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
