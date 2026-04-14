import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const setupTeamCompositeTool = {
  name: "setup_team",
  description:
    "Create a routing team with members and assignment strategy in one step. " +
    "PREFERRED over the 3-step sequence of create_team + add_team_member + update_team_weights. " +
    "Works for both Salesforce and HubSpot orgs.",
  inputSchema: {
    type: "object" as const,
    properties: {
      name: { type: "string", description: "Team name" },
      strategy: {
        type: "string",
        enum: ["round_robin", "weighted", "manual"],
        description: "Assignment strategy",
      },
      members: {
        type: "array",
        items: { type: "string" },
        description: "Email addresses of team members",
      },
      weights: {
        type: "object",
        description: "Member weight overrides (userId -> weight)",
      },
    },
    required: ["name"],
  },
};

export async function handleSetupTeamComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1SetupTeam(args);
    const durationMs = Date.now() - start;
    logger.log({ tool: "setup_team", action: "execute", input: args, result, durationMs });

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
    logger.log({ tool: "setup_team", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (create_team, add_team_member) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
