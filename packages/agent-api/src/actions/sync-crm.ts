import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { FieldService } from "../services/field";
import { QueueService } from "../services/queue";

interface SyncCrmInput {
  objectTypes?: string[];
}

interface SyncCrmOutput {
  objectsSynced: Array<{ objectType: string; fieldsSynced: number }>;
  queuesSynced: number;
}

export async function syncCrm(
  input: SyncCrmInput,
  ctx: AgentContext,
): Promise<AgentResponse<SyncCrmOutput | null>> {
  const start = Date.now();
  const tool = "sync_crm_schema";
  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    const objectTypes = input.objectTypes ?? ["LEAD", "CONTACT", "ACCOUNT"];
    const objectsSynced: Array<{ objectType: string; fieldsSynced: number }> = [];

    for (const objectType of objectTypes) {
      const result = await FieldService.sync(objectType, ctx);
      objectsSynced.push({ objectType, fieldsSynced: result.fieldsSynced });
      actions.push(`Synced ${result.fieldsSynced} field(s) for ${objectType}`);
    }

    const queueResult = await QueueService.sync(ctx);
    if (queueResult.warning) {
      warnings.push(queueResult.warning);
    }
    actions.push(
      queueResult.synced > 0
        ? `Synced ${queueResult.synced} queue(s)`
        : "Queue sync complete",
    );

    return ok(
      { objectsSynced, queuesSynced: queueResult.synced },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "setup_routing_rule", reason: "Create routing rules using synced fields" },
          { action: "import_users", reason: "Import CRM users for assignment" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "SYNC_CRM_FAILED",
      error instanceof Error ? error.message : String(error),
      "Check CRM connection credentials and permissions. Ensure OAuth token is valid.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
