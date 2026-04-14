import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const routeRecordCompositeTool = {
  name: "route_record",
  description:
    "Route a single CRM record through the routing engine with full context. " +
    "Returns the matched rule, assigned owner, and CRM write status. " +
    "PREFERRED over route_lead for agent workflows that need the full result.",
  inputSchema: {
    type: "object" as const,
    properties: {
      objectType: {
        type: "string",
        enum: ["LEAD", "CONTACT", "ACCOUNT", "COMPANY", "DEAL"],
        description: "CRM object type",
      },
      recordId: { type: "string", description: "CRM record ID" },
      fields: {
        type: "object",
        description: "Record field values for rule evaluation",
      },
      dryRun: {
        type: "boolean",
        description: "If true, evaluate rules but don't write to CRM. Defaults to false.",
      },
    },
    required: ["objectType", "recordId"],
  },
};

export async function handleRouteRecordComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1RouteRecord(args);
    const durationMs = Date.now() - start;
    logger.log({ tool: "route_record", action: "execute", input: args, result, durationMs });

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
    logger.log({ tool: "route_record", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tool (route_lead) which works with your current token."
      );
    }
    return errorResponse(msg);
  }
}
