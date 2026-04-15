import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { RuleService } from "../services/rule";

interface CloneModifyRuleInput {
  sourceRuleId: string;
  newName?: string;
  modifications?: {
    objectType?: string;
    triggerEvent?: string;
    assignTo?: {
      teamId?: string;
      userId?: string;
      queueId?: string;
    };
    activate?: boolean;
  };
}

interface CloneModifyRuleOutput {
  sourceRuleId: string;
  newRuleId: string;
  name: string;
  status: string;
}

export async function cloneModifyRule(
  input: CloneModifyRuleInput,
  ctx: AgentContext,
): Promise<AgentResponse<CloneModifyRuleOutput | null>> {
  const start = Date.now();
  const tool = "clone_and_modify_rule";
  const actions: string[] = [];
  const warnings: string[] = [];
  let clonedRuleId: string | undefined;

  try {
    const cloned = await RuleService.clone(input.sourceRuleId, input.newName, ctx);
    clonedRuleId = cloned.id;
    actions.push(`Cloned rule ${input.sourceRuleId} -> ${cloned.id}`);

    if (input.modifications) {
      const updateData: Record<string, unknown> = {};
      if (input.modifications.objectType) updateData.objectType = input.modifications.objectType;
      if (input.modifications.triggerEvent) updateData.triggerEvent = input.modifications.triggerEvent;

      if (input.modifications.assignTo) {
        const a = input.modifications.assignTo;
        if (a.userId) {
          updateData.assignmentType = "USER";
          updateData.assigneeUserId = a.userId;
        } else if (a.teamId) {
          updateData.assignmentType = "ROUND_ROBIN";
          updateData.assigneeTeamId = a.teamId;
        } else if (a.queueId) {
          updateData.assignmentType = "QUEUE";
          updateData.assigneeQueueId = a.queueId;
        }
      }

      if (Object.keys(updateData).length > 0) {
        await RuleService.update(cloned.id, updateData as any, ctx);
        actions.push(`Applied modifications: ${Object.keys(updateData).join(", ")}`);
      }
    }

    let status = "INACTIVE";
    if (input.modifications?.activate) {
      await RuleService.activate(cloned.id, ctx);
      status = "ACTIVE";
      actions.push("Activated cloned rule");
    }

    return ok(
      {
        sourceRuleId: input.sourceRuleId,
        newRuleId: cloned.id,
        name: input.newName ?? cloned.name,
        status,
      },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "reorder_rules", reason: "Set priority for the new rule" },
          { action: "route_record", reason: "Test the cloned rule" },
        ],
      },
    );
  } catch (error) {
    if (clonedRuleId) {
      try {
        await RuleService.delete(clonedRuleId, ctx);
        actions.push(`Rolled back: deleted cloned rule ${clonedRuleId}`);
      } catch {
        // best-effort cleanup
      }
    }

    return fail(
      "CLONE_MODIFY_FAILED",
      error instanceof Error ? error.message : String(error),
      "Verify the source rule exists and override values are valid.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
