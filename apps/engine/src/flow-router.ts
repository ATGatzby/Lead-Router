import { prisma } from "@lead-routing/db";
import { getActiveFlow } from "./flow-cache.js";
import type { CachedFlow, CachedFlowNode } from "./flow-types.js";
import { evaluateRule } from "./evaluator.js";
import type { EvalCondition } from "./evaluator.js";
import { getOrgConnection } from "./sfdc.js";
import type { RoutingPayload, RoutingResult } from "./router.js";

const MAX_DEPTH = 50;

// ─── Main flow routing entry point ──────────────────────────────────────────

export async function routeFlowRecord(
  payload: RoutingPayload,
  startMs: number
): Promise<RoutingResult> {
  const { orgId, objectType, eventType, recordId, fields } = payload;

  const flow = getActiveFlow(orgId, objectType);
  if (!flow) return "unmatched";

  // Find entry node
  const entryNode = flow.nodes.find((n) => n.type === "ENTRY");
  if (!entryNode) return "unmatched";

  // Check trigger event match
  const entryConfig = entryNode.config as Record<string, unknown> | null;
  const flowTriggerEvent = (entryConfig?.triggerEvent as string) ?? flow.triggerEvent;
  if (flowTriggerEvent !== "BOTH" && flowTriggerEvent !== eventType) {
    return "unmatched";
  }

  // Check trigger conditions on entry node
  const triggerConditions = entryConfig?.triggerConditions;
  if (Array.isArray(triggerConditions) && triggerConditions.length > 0) {
    const flatConditions = flattenConditionGroups(triggerConditions);
    const triggerMatch = await evaluateRule(fields, flatConditions, orgId);
    if (!triggerMatch) return "unmatched";
  }

  // ── Traverse the graph ──────────────────────────────────────────────────
  let currentNodeId = entryNode.id;
  const nodePath: string[] = [currentNodeId];
  let depth = 0;

  while (depth < MAX_DEPTH) {
    depth++;
    const currentNode = flow.nodes.find((n) => n.id === currentNodeId);
    if (!currentNode) break;

    const outEdges = flow.edges.filter((e) => e.fromId === currentNodeId);

    switch (currentNode.type) {
      case "ENTRY": {
        const nextEdge = outEdges[0];
        if (!nextEdge) return "unmatched";
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "DECISION": {
        const config = currentNode.config as Record<string, unknown> | null;
        const conditions = (config?.conditions ?? []) as unknown[];
        const flatConditions = flattenConditionGroups(conditions);
        const matched = await evaluateRule(fields, flatConditions, orgId);

        // Support both "True"/"False" and "YES"/"NO" edge labels
        const nextEdge = matched
          ? outEdges.find((e) => e.label === "True") ?? outEdges.find((e) => e.label === "YES")
          : outEdges.find((e) => e.label === "False") ?? outEdges.find((e) => e.label === "NO");
        if (!nextEdge) return "unmatched";
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "BRANCH_DECISION": {
        const config = currentNode.config as Record<string, unknown> | null;
        const branches = (config?.branches ?? []) as Array<{
          label: string;
          conditions?: unknown[];
        }>;
        let matchedLabel: string | null = null;

        for (const branch of branches) {
          const flatConditions = flattenConditionGroups(branch.conditions ?? []);
          if (flatConditions.length === 0) continue;
          const matched = await evaluateRule(fields, flatConditions, orgId);
          if (matched) {
            matchedLabel = branch.label;
            break;
          }
        }

        const defaultLabel = (config?.defaultLabel as string) ?? "Default";
        const nextEdge = matchedLabel
          ? outEdges.find((e) => e.label === matchedLabel)
          : outEdges.find((e) => e.label === defaultLabel);

        if (!nextEdge) return "unmatched";
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "FILTER": {
        const config = currentNode.config as Record<string, unknown> | null;
        const conditions = (config?.conditions ?? []) as unknown[];
        const flatConditions = flattenConditionGroups(conditions);

        if (flatConditions.length === 0 || (await evaluateRule(fields, flatConditions, orgId))) {
          const nextEdge = outEdges[0];
          if (!nextEdge) return "unmatched";
          currentNodeId = nextEdge.toId;
          nodePath.push(currentNodeId);
        } else {
          // Filter didn't pass — record is excluded
          return "unmatched";
        }
        break;
      }

      case "MATCH": {
        // TODO: Implement match logic reusing existing runMatcher pattern
        // For now, follow the single outgoing edge
        const nextEdge = outEdges[0];
        if (!nextEdge) return "unmatched";
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "UPDATE_FIELD": {
        const config = currentNode.config as Record<string, unknown> | null;
        if (config?.fieldApiName && config?.fieldValue !== undefined) {
          try {
            const conn = await getOrgConnection(orgId);
            const sObjectName = toSfdcObjectName(objectType);
            await conn
              .sobject(sObjectName)
              .update({ Id: recordId, [config.fieldApiName as string]: config.fieldValue });
          } catch (err) {
            console.error(`[flow-router] UPDATE_FIELD failed for ${recordId}:`, err);
          }
        }
        const nextEdge = outEdges[0];
        if (!nextEdge) return "unmatched";
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "CREATE_TASK": {
        const config = currentNode.config as Record<string, unknown> | null;
        if (config?.subject) {
          try {
            const conn = await getOrgConnection(orgId);
            const taskData: Record<string, unknown> = {
              Subject: config.subject,
              Priority: (config.priority as string) ?? "Normal",
              Status: (config.status as string) ?? "Not Started",
              Description: (config.description as string) ?? "",
            };
            // Link to the record via WhoId (Lead/Contact) or WhatId (Account)
            if (objectType === "LEAD" || objectType === "CONTACT") {
              taskData.WhoId = recordId;
            } else {
              taskData.WhatId = recordId;
            }
            // Due date offset
            if (config.dueDateOffset) {
              const due = new Date();
              due.setDate(due.getDate() + Number(config.dueDateOffset));
              taskData.ActivityDate = due.toISOString().split("T")[0];
            }
            await conn.sobject("Task").create(taskData);
          } catch (err) {
            console.error(`[flow-router] CREATE_TASK failed for ${recordId}:`, err);
          }
        }
        const nextEdge = outEdges[0];
        if (!nextEdge) return "unmatched";
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "ASSIGNMENT":
      case "DEFAULT": {
        // Terminal node — resolve assignee and assign
        return handleAssignmentNode(
          currentNode,
          flow,
          payload,
          nodePath,
          startMs
        );
      }

      default:
        return "unmatched";
    }
  }

  // Max depth exceeded
  console.error(
    `[flow-router] Max depth ${MAX_DEPTH} exceeded for record ${recordId} in flow ${flow.id}`
  );
  return "unmatched";
}

// ─── Assignment node handler ──────────────────────────────────────────────────

async function handleAssignmentNode(
  node: CachedFlowNode,
  flow: CachedFlow,
  payload: RoutingPayload,
  nodePath: string[],
  startMs: number
): Promise<RoutingResult> {
  const { orgId, objectType, eventType, recordId } = payload;
  const config = node.config as Record<string, unknown> | null;
  const assignmentType = config?.assignmentType as string | undefined;
  const assigneeId = config?.assigneeId as string | undefined;

  if (!assignmentType || !assigneeId) {
    await logFlowRouting({
      orgId,
      flowId: flow.id,
      recordId,
      objectType,
      eventType,
      nodePath,
      status: "UNMATCHED",
      pathLabel: node.label,
      isDryRun: flow.isDryRun,
      startMs,
    });
    return "unmatched";
  }

  // Resolve the assignee using the existing helper from router.ts
  const { resolveAssigneeFromFields } = await import("./router.js");

  const assignee = await resolveAssigneeFromFields(
    assignmentType,
    assignmentType === "USER" ? assigneeId : null,
    assignmentType === "ROUND_ROBIN" ? assigneeId : null,
    assignmentType === "QUEUE" ? assigneeId : null,
    orgId
  );

  if (!assignee) {
    await logFlowRouting({
      orgId,
      flowId: flow.id,
      recordId,
      objectType,
      eventType,
      nodePath,
      status: "FAILED",
      pathLabel: node.label,
      isDryRun: flow.isDryRun,
      errorMessage: "Failed to resolve assignee",
      startMs,
    });
    return "unmatched";
  }

  // Log the routing result
  const pathLabel =
    node.label ?? (node.type === "DEFAULT" ? "Default" : "Assignment");
  await logFlowRouting({
    orgId,
    flowId: flow.id,
    recordId,
    objectType,
    eventType,
    nodePath,
    status: "SUCCESS",
    pathLabel,
    isDryRun: flow.isDryRun,
    startMs,
    assignee,
  });

  if (flow.isDryRun) return "dry_run";

  // Update owner in Salesforce
  try {
    const { updateOwner } = await import("@lead-routing/sfdc");
    const sObjectName = toSfdcObjectName(objectType);
    await updateOwner(orgId, sObjectName, recordId, assignee.sfdcOwnerId);
  } catch (err) {
    console.error(`[flow-router] SFDC owner update failed for ${recordId}:`, err);
    // Still count as routed — retry mechanism can handle this
  }

  return "routed";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Capitalise first letter only: LEAD -> Lead */
function toSfdcObjectName(objectType: string): string {
  return objectType.charAt(0) + objectType.slice(1).toLowerCase();
}

/**
 * Flatten ConditionGroup[] or flat condition arrays into EvalCondition[]
 * for the evaluator. Handles both formats:
 *
 * Format A (ConditionGroup): [{ id, conditions: [{ fieldApiName, operator, value }] }]
 * Format B (flat):           [{ groupId, fieldName, operator, value }]
 */
function flattenConditionGroups(groups: unknown[]): EvalCondition[] {
  if (!Array.isArray(groups)) return [];

  const result: EvalCondition[] = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const g = group as Record<string, unknown>;

    if (Array.isArray(g.conditions)) {
      // Format A: ConditionGroup with nested conditions array
      const groupId = (g.id as string) ?? crypto.randomUUID();
      for (const cond of g.conditions as Array<Record<string, unknown>>) {
        result.push({
          groupId,
          fieldName: (cond.fieldApiName as string) ?? (cond.fieldName as string) ?? "",
          operator: (cond.operator as string) ?? "",
          value: cond.value != null ? String(cond.value) : null,
        });
      }
    } else if (g.fieldName || g.fieldApiName) {
      // Format B: flat condition object
      result.push({
        groupId: (g.groupId as string) ?? crypto.randomUUID(),
        fieldName: (g.fieldApiName as string) ?? (g.fieldName as string) ?? "",
        operator: (g.operator as string) ?? "",
        value: g.value != null ? String(g.value) : null,
      });
    }
  }
  return result;
}

// ─── Flow routing log ─────────────────────────────────────────────────────────

interface FlowLogParams {
  orgId: string;
  flowId: string;
  recordId: string;
  objectType: string;
  eventType: string;
  nodePath: string[];
  status: string;
  pathLabel?: string | null;
  isDryRun?: boolean;
  errorMessage?: string;
  startMs: number;
  assignee?: {
    sfdcOwnerId: string;
    assigneeId: string;
    assigneeName: string;
    assignmentType: string;
    teamId?: string;
    teamName?: string;
  };
}

async function logFlowRouting(params: FlowLogParams): Promise<void> {
  try {
    await prisma.routingLog.create({
      data: {
        orgId: params.orgId,
        flowId: params.flowId,
        sfdcRecordId: params.recordId,
        objectType: params.objectType as any,
        eventType: params.eventType as any,
        status: params.status as any,
        pathLabel: params.pathLabel ?? null,
        isDryRun: params.isDryRun ?? false,
        flowNodePath: params.nodePath,
        assigneeId: params.assignee?.assigneeId ?? null,
        assigneeName: params.assignee?.assigneeName ?? null,
        assignmentType: (params.assignee?.assignmentType as any) ?? null,
        teamId: params.assignee?.teamId ?? null,
        teamName: params.assignee?.teamName ?? null,
        errorMessage: params.errorMessage ?? null,
        routingDurationMs: Date.now() - params.startMs,
      },
    });
  } catch (err) {
    console.error("[flow-router] Failed to create routing log:", err);
  }
}
