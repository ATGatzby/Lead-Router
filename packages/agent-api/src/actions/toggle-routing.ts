import { ok, fail, type AgentContext, type AgentResponse } from "../types";
import { RoutingService } from "../services/routing";

interface ToggleRoutingInput {
  objectType: string;
  mode: string;
}

interface ToggleRoutingOutput {
  modes: Record<string, string>;
}

export async function toggleRouting(
  input: ToggleRoutingInput,
  ctx: AgentContext,
): Promise<AgentResponse<ToggleRoutingOutput | null>> {
  const start = Date.now();
  const tool = "toggle_routing";
  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    const currentMode = await RoutingService.getMode(ctx);
    const previousMode = currentMode[input.objectType];

    if (previousMode === input.mode) {
      warnings.push(
        `${input.objectType} routing mode is already ${input.mode} -- no change made`,
      );
      return ok(
        { modes: currentMode },
        actions,
        tool,
        ctx.crmType,
        Date.now() - start,
        {
          warnings,
          next_actions: [
            { action: "get_routing_status", reason: "View current system status" },
          ],
        },
      );
    }

    const newModes = await RoutingService.setMode(input.objectType, input.mode, ctx);
    actions.push(
      `Changed ${input.objectType} routing mode from ${previousMode} to ${input.mode}`,
    );

    return ok(
      { modes: newModes },
      actions,
      tool,
      ctx.crmType,
      Date.now() - start,
      {
        warnings: warnings.length ? warnings : undefined,
        next_actions: [
          { action: "get_routing_status", reason: "Verify routing mode change" },
          { action: "route_record", reason: "Test with a single record" },
        ],
      },
    );
  } catch (error) {
    return fail(
      "TOGGLE_ROUTING_FAILED",
      error instanceof Error ? error.message : String(error),
      "Check database connectivity. The routing mode is stored in org settings.",
      tool,
      ctx.crmType,
      Date.now() - start,
    );
  }
}
