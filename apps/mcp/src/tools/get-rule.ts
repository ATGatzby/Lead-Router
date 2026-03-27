import type { WebClient } from "../clients/web-client.js";
import type { Logger } from "../utils/logger.js";
import { successResponse } from "../utils/confirm.js";

export const getRuleTool = {
  name: "get_rule",
  description: "Get detailed information about a specific routing rule including its conditions, branches, and configuration",
  inputSchema: {
    type: "object" as const,
    properties: {
      ruleId: {
        type: "string",
        description: "The ID of the routing rule to retrieve",
      },
    },
    required: ["ruleId"],
  },
};

export async function handleGetRule(web: WebClient, logger: Logger, args: any) {
  const start = Date.now();
  const response = await web.getRule(args.ruleId);
  const rule = response.rule || response;
  logger.log({ tool: "get_rule", action: "read", input: args, durationMs: Date.now() - start });

  const lines: string[] = [
    `Rule: ${rule.name}`,
    `ID: ${rule.id}`,
    `Object Type: ${rule.objectType}`,
    `Trigger Event: ${rule.triggerEvent}`,
    `Status: ${rule.status}`,
    `Priority: ${rule.priority ?? "—"}`,
  ];

  if (rule.triggerConditions?.length) {
    lines.push("", "Trigger Conditions:");
    for (const tc of rule.triggerConditions) {
      lines.push(`  ${tc.fieldName} ${tc.operator} ${tc.value ?? ""}`);
    }
  }

  if (rule.conditions?.length) {
    lines.push("", "Conditions:");
    for (const c of rule.conditions) {
      lines.push(`  ${c.fieldName} ${c.operator} ${c.value ?? ""}`);
    }
  }

  if (rule.branches?.length) {
    lines.push("", "Branches:");
    for (const b of rule.branches) {
      lines.push(`  Branch: ${b.label || b.name || "Unnamed"}`);
      if (b.conditions?.length) {
        for (const c of b.conditions) {
          lines.push(`    ${c.fieldName} ${c.operator} ${c.value ?? ""}`);
        }
      }
      if (b.assignment) {
        lines.push(`    Assignment: ${JSON.stringify(b.assignment)}`);
      }
    }
  }

  if (rule.matchConfig) {
    lines.push("", `Match Config: ${JSON.stringify(rule.matchConfig)}`);
  }

  return successResponse(lines.join("\n"));
}
