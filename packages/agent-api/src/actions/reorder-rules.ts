import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { RuleService } from "../services/rule";

interface ReorderRulesInput {
  objectType: string;
  ruleIds: string[];
}

interface ReorderRulesOutput {
  objectType: string;
  newOrder: Array<{ ruleId: string; priority: number }>;
}

export async function reorderRules(
  input: ReorderRulesInput,
  ctx: AgentContext,
): Promise<AgentResponse<ReorderRulesOutput | null>> {
  const start = Date.now();
  const tool = "reorder_rules";
  const actions: string[] = [];

  try {
    const result = await RuleService.reorder(input.objectType, input.ruleIds, ctx);
    const newOrder = result.map((r) => ({ ruleId: r.rule_id, priority: r.priority }));
    actions.push(`Reordered ${input.ruleIds.length} rule(s) for ${input.objectType}`);

    return ok(
      { objectType: input.objectType, newOrder },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        next_actions: [
          { action: "route_record", reason: "Test that higher-priority rules match first" },
          { action: "get_performance", reason: "Monitor rule match rates after reorder" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "REORDER_RULES_FAILED",
      error instanceof Error ? error.message : String(error),
      "Ensure all rule IDs are valid and belong to this organization.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
