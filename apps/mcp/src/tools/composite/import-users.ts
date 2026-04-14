import type { WebClient } from "../../clients/web-client.js";
import type { Logger } from "../../utils/logger.js";
import { successResponse, errorResponse } from "../../utils/confirm.js";

export const importUsersCompositeTool = {
  name: "import_users",
  description:
    "Import and license CRM users by role, profile, or email list in one step. " +
    "PREFERRED over sync_users + bulk_license_users. " +
    "Handles sync, filtering, and licensing in a single operation.",
  inputSchema: {
    type: "object" as const,
    properties: {
      by: {
        type: "string",
        enum: ["role", "profile", "emails"],
        description: "How to select users to import",
      },
      value: {
        type: "string",
        description: "The role name, profile name, or comma-separated email list",
      },
      autoLicense: {
        type: "boolean",
        description: "Automatically license imported users. Defaults to true.",
      },
    },
    required: ["by", "value"],
  },
};

export async function handleImportUsersComposite(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  try {
    const result = await web.v1ImportUsers(args);
    const durationMs = Date.now() - start;
    logger.log({ tool: "import_users", action: "execute", input: args, result, durationMs });

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
    logger.log({ tool: "import_users", action: "error", input: args, error: msg, durationMs: Date.now() - start });

    if (msg.includes("403") && msg.includes("agent")) {
      return errorResponse(
        "Your API token needs the 'agent' scope to use composite tools.\n" +
        "Go to Settings > API Tokens to create a new token with the 'agent' scope,\n" +
        "or use the granular tools (sync_users, bulk_license_users) which work with your current token."
      );
    }
    return errorResponse(msg);
  }
}
