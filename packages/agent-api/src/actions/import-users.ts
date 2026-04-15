import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { UserService } from "../services/user";

interface ImportUsersInput {
  autoLicense?: boolean;
  profileFilter?: string[];
}

interface ImportUsersOutput {
  usersSynced: number;
  usersLicensed: number;
}

export async function importUsers(
  input: ImportUsersInput,
  ctx: AgentContext,
): Promise<AgentResponse<ImportUsersOutput | null>> {
  const start = Date.now();
  const tool = "import_users";
  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    const syncResult = await UserService.sync(ctx);
    actions.push(`Synced ${syncResult.synced} user(s) from ${ctx.crmType}`);

    let usersLicensed = 0;
    if (input.autoLicense && syncResult.synced > 0) {
      // License all synced users
      const users = await UserService.list(ctx);
      const unlicensedIds = users.filter((u) => !u.isLicensed).map((u) => u.id);
      if (unlicensedIds.length > 0) {
        const result = await UserService.bulkLicense(unlicensedIds, true, ctx);
        usersLicensed = result.updated;
        actions.push(`Licensed ${usersLicensed} user(s)`);
      }
    }

    return ok(
      { usersSynced: syncResult.synced, usersLicensed },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "setup_team", reason: "Organize imported users into teams" },
          { action: "get_routing_status", reason: "Verify user counts" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "IMPORT_USERS_FAILED",
      error instanceof Error ? error.message : String(error),
      "Check CRM connection and user query permissions.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
