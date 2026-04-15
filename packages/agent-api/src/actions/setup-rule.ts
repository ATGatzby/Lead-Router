import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { RuleService } from "../services/rule";

interface SetupRuleInput {
  name: string;
  objectType: string;
  triggerEvent?: string;
  assignTo: {
    teamId?: string;
    userId?: string;
    queueId?: string;
  };
  criteria?: Array<{ field: string; operator: string; value: unknown }>;
  activate?: boolean;
}

interface SetupRuleOutput {
  ruleId: string;
  name: string;
  objectType: string;
  status: string;
  priority: number;
}

export async function setupRule(
  input: SetupRuleInput,
  ctx: AgentContext,
): Promise<AgentResponse<SetupRuleOutput | null>> {
  const start = Date.now();
  const tool = "setup_routing_rule";
  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    let assignmentType: string | null = null;
    if (input.assignTo.userId) assignmentType = "USER";
    else if (input.assignTo.teamId) assignmentType = "ROUND_ROBIN";
    else if (input.assignTo.queueId) assignmentType = "QUEUE";

    const conditions = input.criteria?.map((c, i) => ({
      groupId: "default",
      fieldName: c.field,
      operator: c.operator,
      value: c.value != null ? String(c.value) : null,
      sortOrder: i,
    }));

    const rule = await RuleService.create(
      {
        name: input.name,
        objectType: input.objectType,
        triggerEvent: input.triggerEvent ?? "INSERT",
        assignmentType,
        assigneeUserId: input.assignTo.userId ?? null,
        assigneeTeamId: input.assignTo.teamId ?? null,
        assigneeQueueId: input.assignTo.queueId ?? null,
        conditions,
      },
      ctx,
    );
    actions.push(`Created rule "${input.name}" (${rule.id})`);

    if (input.criteria && ctx.crmType === "HUBSPOT") {
      warnings.push(
        "Criteria stored in DB only -- HubSpot does not support criteria sync to CRM",
      );
    }

    const shouldActivate = input.activate !== false;
    if (shouldActivate) {
      await RuleService.activate(rule.id, ctx);
      actions.push("Activated rule");
    }

    return ok(
      {
        ruleId: rule.id,
        name: rule.name,
        objectType: rule.objectType,
        status: shouldActivate ? "ACTIVE" : "INACTIVE",
        priority: rule.priority,
      },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "route_record", reason: "Test routing with this rule" },
          { action: "reorder_rules", reason: "Adjust rule priority" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "SETUP_RULE_FAILED",
      error instanceof Error ? error.message : String(error),
      "Verify that the team/user/queue exists and object type is valid.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
