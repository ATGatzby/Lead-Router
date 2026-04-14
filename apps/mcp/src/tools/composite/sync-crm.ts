import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const syncCrmCompositeTool = {
  name: "sync_crm",
  description:
    "Sync CRM data including users, fields, and queues in one step. " +
    "PREFERRED over calling sync_users + sync_fields + sync_queues separately. " +
    "Optionally sync only specific resource types.",
  inputSchema: {
    type: "object" as const,
    properties: {
      resources: {
        type: "array",
        items: { type: "string", enum: ["users", "fields", "queues"] },
        description: "Which resources to sync. Defaults to all if omitted.",
      },
      fullSync: {
        type: "boolean",
        description: "Force a full sync instead of incremental. Defaults to false.",
      },
    },
  },
};

export async function handleSyncCrmComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1SyncCrm(args || {});
    const durationMs = Date.now() - start;
    logger.log({ tool: "sync_crm", action: "execute", input: args, result, durationMs });

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
    logger.log({ tool: "sync_crm", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (sync_users, sync_fields, sync_queues) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
