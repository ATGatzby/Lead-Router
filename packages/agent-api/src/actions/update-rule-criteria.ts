import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { RuleService } from "../services/rule";

interface UpdateRuleCriteriaInput {
  ruleId: string;
  criteria: Array<{ field: string; operator: string; value: unknown }>;
  syncToCrm?: boolean;
}

interface UpdateRuleCriteriaOutput {
  ruleId: string;
  criteriaCount: number;
  syncedToCrm: boolean;
}

export async function updateRuleCriteria(
  input: UpdateRuleCriteriaInput,
  ctx: AgentContext,
): Promise<AgentResponse<UpdateRuleCriteriaOutput | null>> {
  const start = Date.now();
  const tool = "update_rule_criteria";
  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    const count = await RuleService.updateCriteria(input.ruleId, input.criteria, ctx);
    actions.push(`Updated ${count} criteria condition(s) for rule ${input.ruleId}`);

    let syncedToCrm = false;
    if (input.syncToCrm && ctx.crmType === "HUBSPOT") {
      warnings.push(
        "Criteria sync is not supported for HubSpot -- filtering happens server-side",
      );
    }
    // For SFDC, criteria sync would be handled by the caller via CRM API

    return ok(
      { ruleId: input.ruleId, criteriaCount: count, syncedToCrm },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "route_record", reason: "Test routing with updated criteria" },
          { action: "get_performance", reason: "Monitor impact of criteria change" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "UPDATE_CRITERIA_FAILED",
      error instanceof Error ? error.message : String(error),
      "Verify the rule exists and criteria format is valid.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
