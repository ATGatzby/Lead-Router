import { prisma } from "@lead-routing/db";
import { getActiveFlow } from "./flow-cache.js";
import type { CachedFlow, CachedFlowNode } from "./flow-types.js";
import { evaluateRule } from "./evaluator.js";
import type { EvalCondition } from "./evaluator.js";
import { getOrgConnection } from "./sfdc.js";
import type { RoutingPayload, RoutingResult, MatchResult } from "./router.js";

const MAX_DEPTH = 50;

// ─── Flow Decision Trace types ──────────────────────────────────────────────

interface FlowTraceNodeEval {
  nodeId: string;
  nodeType: string;
  label: string | null;
  outcome: "PASSED" | "FAILED" | "MATCHED_BRANCH" | "DEFAULT_BRANCH" | "EXECUTED" | "ASSIGNED" | "SKIPPED" | "NO_EDGE";
  /** For DECISION nodes: which branch was taken (true/false) */
  matchedBranch?: string;
  /** For BRANCH_DECISION nodes: per-branch evaluation results */
  branches?: Array<{
    label: string;
    conditionCount: number;
    matched: boolean;
  }>;
  /** For ASSIGNMENT/DEFAULT nodes: resolved assignee info */
  assignee?: {
    type: string;
    assigneeName: string;
    assigneeId: string;
    teamId?: string;
    teamName?: string;
  };
  /** For MATCH nodes: match evaluation result */
  matchResult?: {
    matched: boolean;
    matchedType?: string;
    matchedRecordId?: string;
    action?: string;
  };
  /** For action nodes (UPDATE_FIELD, CREATE_TASK): whether the action succeeded */
  actionResult?: { success: boolean; error?: string };
  /** Duration of this node's evaluation in ms */
  durationMs?: number;
}

interface FlowDecisionTrace {
  version: 2;
  routerType: "FLOW";
  trigger: {
    event: string;
    objectType: string;
    recordId: string;
    flowId: string;
    flowName?: string;
    timestampMs: number;
  };
  triggerConditions?: {
    conditionCount: number;
    matched: boolean;
  };
  nodesTraversed: FlowTraceNodeEval[];
  assignment?: {
    type: string;
    assigneeName: string;
    assigneeId: string;
    teamId?: string;
    teamName?: string;
  };
  timing: {
    totalMs: number;
  };
}

function createFlowTrace(payload: RoutingPayload, flowId: string, flowName?: string): FlowDecisionTrace {
  return {
    version: 2,
    routerType: "FLOW",
    trigger: {
      event: payload.eventType,
      objectType: payload.objectType,
      recordId: payload.recordId,
      flowId,
      flowName,
      timestampMs: Date.now(),
    },
    nodesTraversed: [],
    timing: { totalMs: 0 },
  };
}

// ─── Main flow routing entry point ──────────────────────────────────────────

export async function routeFlowRecord(
  payload: RoutingPayload,
  startMs: number
): Promise<RoutingResult> {
  const { orgId, objectType, eventType, recordId, fields } = payload;

  const flow = getActiveFlow(orgId, objectType);
  if (!flow) {
    return "unmatched";
  }

  const trace = createFlowTrace(payload, flow.id, flow.name);

  // Find entry node
  const entryNode = flow.nodes.find((n) => n.type === "ENTRY");
  if (!entryNode) {
    return "unmatched";
  }

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
    trace.triggerConditions = { conditionCount: flatConditions.length, matched: triggerMatch };
    if (!triggerMatch) {
      trace.timing.totalMs = Date.now() - startMs;
      return "unmatched";
    }
  }

  // ── Traverse the graph ──────────────────────────────────────────────────
  let currentNodeId = entryNode.id;
  const nodePath: string[] = [currentNodeId];
  let depth = 0;

  while (depth < MAX_DEPTH) {
    depth++;
    const currentNode = flow.nodes.find((n) => n.id === currentNodeId);
    if (!currentNode) {
      break;
    }

    const outEdges = flow.edges.filter((e) => e.fromId === currentNodeId);
    switch (currentNode.type) {
      case "ENTRY": {
        const nextEdge = outEdges[0];
        trace.nodesTraversed.push({
          nodeId: currentNode.id,
          nodeType: currentNode.type,
          label: currentNode.label,
          outcome: nextEdge ? "PASSED" : "NO_EDGE",
        });
        if (!nextEdge) {
          trace.timing.totalMs = Date.now() - startMs;
          return "unmatched";
        }
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "DECISION": {
        const nodeStart = Date.now();
        const config = currentNode.config as Record<string, unknown> | null;
        const conditions = (config?.conditions ?? []) as unknown[];
        const flatConditions = flattenConditionGroups(conditions);
        const matched = await evaluateRule(fields, flatConditions, orgId);
        trace.nodesTraversed.push({
          nodeId: currentNode.id,
          nodeType: currentNode.type,
          label: currentNode.label,
          outcome: matched ? "PASSED" : "FAILED",
          matchedBranch: matched ? "true" : "false",
          durationMs: Date.now() - nodeStart,
        });

        // Support label-based ("True"/"False", "YES"/"NO") and handle-based ("true"/"false") edge matching
        const nextEdge = matched
          ? outEdges.find((e) => e.label === "True") ?? outEdges.find((e) => e.label === "YES") ?? outEdges.find((e) => e.sourceHandle === "true")
          : outEdges.find((e) => e.label === "False") ?? outEdges.find((e) => e.label === "NO") ?? outEdges.find((e) => e.sourceHandle === "false");
        if (!nextEdge) {
          trace.timing.totalMs = Date.now() - startMs;
          return "unmatched";
        }
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "BRANCH_DECISION": {
        const nodeStart = Date.now();
        const config = currentNode.config as Record<string, unknown> | null;
        const branches = (config?.branches ?? []) as Array<{
          label: string;
          conditions?: unknown[];
        }>;
        let matchedLabel: string | null = null;
        const branchResults: Array<{ label: string; conditionCount: number; matched: boolean }> = [];

        for (const branch of branches) {
          const flatConditions = flattenConditionGroups(branch.conditions ?? []);
          if (flatConditions.length === 0) {
            branchResults.push({ label: branch.label, conditionCount: 0, matched: false });
            continue;
          }
          const matched = await evaluateRule(fields, flatConditions, orgId);
          branchResults.push({ label: branch.label, conditionCount: flatConditions.length, matched });
          if (matched) {
            matchedLabel = branch.label;
            break;
          }
        }

        const defaultLabel = (config?.defaultLabel as string) ?? "Default";
        trace.nodesTraversed.push({
          nodeId: currentNode.id,
          nodeType: currentNode.type,
          label: currentNode.label,
          outcome: matchedLabel ? "MATCHED_BRANCH" : "DEFAULT_BRANCH",
          matchedBranch: matchedLabel ?? defaultLabel,
          branches: branchResults,
          durationMs: Date.now() - nodeStart,
        });

        const nextEdge = matchedLabel
          ? outEdges.find((e) => e.label === matchedLabel)
          : outEdges.find((e) => e.label === defaultLabel);

        if (!nextEdge) {
          trace.timing.totalMs = Date.now() - startMs;
          return "unmatched";
        }
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "FILTER": {
        const nodeStart = Date.now();
        const config = currentNode.config as Record<string, unknown> | null;
        const conditions = (config?.conditions ?? []) as unknown[];
        const flatConditions = flattenConditionGroups(conditions);

        const passed = flatConditions.length === 0 || (await evaluateRule(fields, flatConditions, orgId));
        trace.nodesTraversed.push({
          nodeId: currentNode.id,
          nodeType: currentNode.type,
          label: currentNode.label,
          outcome: passed ? "PASSED" : "FAILED",
          durationMs: Date.now() - nodeStart,
        });

        if (passed) {
          const nextEdge = outEdges[0];
          if (!nextEdge) {
            trace.timing.totalMs = Date.now() - startMs;
            return "unmatched";
          }
          currentNodeId = nextEdge.toId;
          nodePath.push(currentNodeId);
        } else {
          // Filter didn't pass — record is excluded
          trace.timing.totalMs = Date.now() - startMs;
          return "unmatched";
        }
        break;
      }

      case "MATCH": {
        const nodeStart = Date.now();
        const config = currentNode.config as Record<string, unknown> | null;

        // Try to get SFDC connection for match evaluation
        let conn: any;
        try {
          conn = await getOrgConnection(orgId);
        } catch (err) {
          console.error(`[flow-router] Could not get SFDC connection for MATCH node, skipping match`);
        }

        let matchResult: MatchResult | null = null;

        if (conn && config) {
          const { runMatcher } = await import("./router.js");
          const matchConfig = config as unknown as import("./cache.js").CachedMatchConfig;
          matchResult = await runMatcher(fields, matchConfig, conn, recordId, orgId);
        }

        if (matchResult) {
          // Determine the action for the matched type
          let action: string | undefined;
          let customAssignmentType: string | null = null;
          let customUserId: string | null = null;
          let customTeamId: string | null = null;
          let customQueueId: string | null = null;

          if (matchResult.type === "LEAD") {
            action = config?.onLeadMatch as string | undefined;
            customAssignmentType = config?.leadAssignmentType as string | null ?? null;
            customUserId = config?.leadAssigneeUserId as string | null ?? null;
            customTeamId = config?.leadAssigneeTeamId as string | null ?? null;
            customQueueId = config?.leadAssigneeQueueId as string | null ?? null;
          } else if (matchResult.type === "CONTACT") {
            action = config?.onContactMatch as string | undefined;
            customAssignmentType = config?.contactAssignmentType as string | null ?? null;
            customUserId = config?.contactAssigneeUserId as string | null ?? null;
            customTeamId = config?.contactAssigneeTeamId as string | null ?? null;
            customQueueId = config?.contactAssigneeQueueId as string | null ?? null;
          } else if (matchResult.type === "ACCOUNT") {
            action = config?.onAccountMatch as string | undefined;
            customAssignmentType = config?.accountAssignmentType as string | null ?? null;
            customUserId = config?.accountAssigneeUserId as string | null ?? null;
            customTeamId = config?.accountAssigneeTeamId as string | null ?? null;
            customQueueId = config?.accountAssigneeQueueId as string | null ?? null;
          }

          // ── ASSIGN_TO_OWNER: assign to the matched record's owner ──
          if (action === "ASSIGN_TO_OWNER") {
            trace.nodesTraversed.push({
              nodeId: currentNode.id,
              nodeType: currentNode.type,
              label: currentNode.label,
              outcome: "ASSIGNED",
              matchResult: {
                matched: true,
                matchedType: matchResult.type,
                matchedRecordId: matchResult.recordId,
                action: "ASSIGN_TO_OWNER",
              },
              durationMs: Date.now() - nodeStart,
            });
            trace.timing.totalMs = Date.now() - startMs;

            await logFlowRouting({
              orgId,
              flowId: flow.id,
              recordId,
              objectType,
              eventType,
              nodePath,
              status: flow.isDryRun ? "DRY_RUN" : "SUCCESS",
              pathLabel: currentNode.label ?? `Match → ${matchResult.type} Owner`,
              isDryRun: flow.isDryRun,
              startMs,
              assignee: {
                sfdcOwnerId: matchResult.ownerId,
                assigneeId: matchResult.ownerId,
                assigneeName: `Matched ${matchResult.type.charAt(0) + matchResult.type.slice(1).toLowerCase()} Owner`,
                assignmentType: "USER",
              },
              decisionTrace: trace,
            });

            if (!flow.isDryRun) {
              try {
                const { updateOwner } = await import("@lead-routing/sfdc");
                const sObjectName = toSfdcObjectName(objectType);
                await updateOwner(conn, sObjectName, recordId, matchResult.ownerId);
              } catch (err) {
                console.error(`[flow-router] SFDC owner update failed for ${recordId}:`, err);
              }
              return "routed";
            }
            return "dry_run";
          }

          // ── SFDC_MERGE: merge the incoming lead into the matched lead ──
          if (action === "SFDC_MERGE") {
            trace.nodesTraversed.push({
              nodeId: currentNode.id,
              nodeType: currentNode.type,
              label: currentNode.label,
              outcome: "EXECUTED",
              matchResult: {
                matched: true,
                matchedType: matchResult.type,
                matchedRecordId: matchResult.recordId,
                action: "SFDC_MERGE",
              },
              durationMs: Date.now() - nodeStart,
            });
            trace.timing.totalMs = Date.now() - startMs;

            if (!flow.isDryRun) {
              try {
                const { mergeLead } = await import("@lead-routing/sfdc");
                await mergeLead(conn, matchResult.recordId, recordId);
              } catch (err) {
                console.error(`[flow-router] Lead merge failed:`, err);
                await logFlowRouting({
                  orgId,
                  flowId: flow.id,
                  recordId,
                  objectType,
                  eventType,
                  nodePath,
                  status: "FAILED",
                  pathLabel: currentNode.label ?? "Match → Merge",
                  isDryRun: false,
                  errorMessage: String(err),
                  startMs,
                  decisionTrace: trace,
                });
                return "unmatched";
              }
            }

            await logFlowRouting({
              orgId,
              flowId: flow.id,
              recordId,
              objectType,
              eventType,
              nodePath,
              status: flow.isDryRun ? "DRY_RUN" : "MERGED",
              pathLabel: currentNode.label ?? "Match → Merge",
              isDryRun: flow.isDryRun,
              startMs,
              decisionTrace: trace,
            });

            return flow.isDryRun ? "dry_run" : "merged";
          }

          // ── ASSIGN_CUSTOM: resolve a custom assignee ──
          if (action === "ASSIGN_CUSTOM" && customAssignmentType) {
            const { resolveAssigneeFromFields } = await import("./router.js");
            const assignee = await resolveAssigneeFromFields(
              customAssignmentType,
              customUserId,
              customTeamId,
              customQueueId,
              orgId
            );

            if (assignee) {
              trace.nodesTraversed.push({
                nodeId: currentNode.id,
                nodeType: currentNode.type,
                label: currentNode.label,
                outcome: "ASSIGNED",
                matchResult: {
                  matched: true,
                  matchedType: matchResult.type,
                  matchedRecordId: matchResult.recordId,
                  action: "ASSIGN_CUSTOM",
                },
                assignee: {
                  type: assignee.assignmentType,
                  assigneeName: assignee.assigneeName,
                  assigneeId: assignee.assigneeId,
                  teamId: assignee.teamId,
                  teamName: assignee.teamName,
                },
                durationMs: Date.now() - nodeStart,
              });
              trace.assignment = {
                type: assignee.assignmentType,
                assigneeName: assignee.assigneeName,
                assigneeId: assignee.assigneeId,
                teamId: assignee.teamId,
                teamName: assignee.teamName,
              };
              trace.timing.totalMs = Date.now() - startMs;

              await logFlowRouting({
                orgId,
                flowId: flow.id,
                recordId,
                objectType,
                eventType,
                nodePath,
                status: flow.isDryRun ? "DRY_RUN" : "SUCCESS",
                pathLabel: currentNode.label ?? `Match → Custom (${matchResult.type})`,
                isDryRun: flow.isDryRun,
                startMs,
                assignee,
                decisionTrace: trace,
              });

              if (!flow.isDryRun) {
                try {
                  const { updateOwner } = await import("@lead-routing/sfdc");
                  const sObjectName = toSfdcObjectName(objectType);
                  await updateOwner(conn, sObjectName, recordId, assignee.sfdcOwnerId);
                } catch (err) {
                  console.error(`[flow-router] SFDC owner update failed for ${recordId}:`, err);
                }
                return "routed";
              }
              return "dry_run";
            }
            // If assignee resolution failed, fall through to next node
          }

          // ── SKIP or unrecognized action: continue to next node ──
          trace.nodesTraversed.push({
            nodeId: currentNode.id,
            nodeType: currentNode.type,
            label: currentNode.label,
            outcome: "SKIPPED",
            matchResult: {
              matched: true,
              matchedType: matchResult.type,
              matchedRecordId: matchResult.recordId,
              action: action ?? "SKIP",
            },
            durationMs: Date.now() - nodeStart,
          });
        } else {
          // No match found — continue to next node
          trace.nodesTraversed.push({
            nodeId: currentNode.id,
            nodeType: currentNode.type,
            label: currentNode.label,
            outcome: "PASSED",
            matchResult: { matched: false },
            durationMs: Date.now() - nodeStart,
          });
        }

        // Fall through: no match, SKIP action, or failed custom assignee resolution
        const nextEdge = outEdges[0];
        if (!nextEdge) {
          trace.timing.totalMs = Date.now() - startMs;
          return "unmatched";
        }
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "UPDATE_FIELD": {
        const nodeStart = Date.now();
        const config = currentNode.config as Record<string, unknown> | null;
        let actionSuccess = true;
        let actionError: string | undefined;
        if (config?.fieldApiName && config?.fieldValue !== undefined) {
          try {
            const conn = await getOrgConnection(orgId);
            const sObjectName = toSfdcObjectName(objectType);
            await conn
              .sobject(sObjectName)
              .update({ Id: recordId, [config.fieldApiName as string]: config.fieldValue });
          } catch (err) {
            actionSuccess = false;
            actionError = err instanceof Error ? err.message : String(err);
            console.error(`[flow-router] UPDATE_FIELD failed for ${recordId}:`, err);
          }
        }
        trace.nodesTraversed.push({
          nodeId: currentNode.id,
          nodeType: currentNode.type,
          label: currentNode.label,
          outcome: "EXECUTED",
          actionResult: { success: actionSuccess, error: actionError },
          durationMs: Date.now() - nodeStart,
        });
        const nextEdge = outEdges[0];
        if (!nextEdge) {
          trace.timing.totalMs = Date.now() - startMs;
          return "unmatched";
        }
        currentNodeId = nextEdge.toId;
        nodePath.push(currentNodeId);
        break;
      }

      case "CREATE_TASK": {
        const nodeStart = Date.now();
        const config = currentNode.config as Record<string, unknown> | null;
        let actionSuccess = true;
        let actionError: string | undefined;
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
            actionSuccess = false;
            actionError = err instanceof Error ? err.message : String(err);
            console.error(`[flow-router] CREATE_TASK failed for ${recordId}:`, err);
          }
        }
        trace.nodesTraversed.push({
          nodeId: currentNode.id,
          nodeType: currentNode.type,
          label: currentNode.label,
          outcome: "EXECUTED",
          actionResult: { success: actionSuccess, error: actionError },
          durationMs: Date.now() - nodeStart,
        });
        const nextEdge = outEdges[0];
        if (!nextEdge) {
          trace.timing.totalMs = Date.now() - startMs;
          return "unmatched";
        }
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
          startMs,
          trace
        );
      }

      default:
        trace.nodesTraversed.push({
          nodeId: currentNode.id,
          nodeType: currentNode.type,
          label: currentNode.label,
          outcome: "SKIPPED",
        });
        trace.timing.totalMs = Date.now() - startMs;
        return "unmatched";
    }
  }

  // Max depth exceeded
  console.error(
    `[flow-router] Max depth ${MAX_DEPTH} exceeded for record ${recordId} in flow ${flow.id}`
  );
  trace.timing.totalMs = Date.now() - startMs;
  return "unmatched";
}

// ─── Assignment node handler ──────────────────────────────────────────────────

async function handleAssignmentNode(
  node: CachedFlowNode,
  flow: CachedFlow,
  payload: RoutingPayload,
  nodePath: string[],
  startMs: number,
  trace: FlowDecisionTrace
): Promise<RoutingResult> {
  const { orgId, objectType, eventType, recordId } = payload;
  const config = node.config as Record<string, unknown> | null;
  const assignmentType = config?.assignmentType as string | undefined;
  const assigneeId = config?.assigneeId as string | undefined;

  if (!assignmentType || !assigneeId) {
    trace.nodesTraversed.push({
      nodeId: node.id,
      nodeType: node.type,
      label: node.label,
      outcome: "FAILED",
    });
    trace.timing.totalMs = Date.now() - startMs;
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
      decisionTrace: trace,
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
    trace.nodesTraversed.push({
      nodeId: node.id,
      nodeType: node.type,
      label: node.label,
      outcome: "FAILED",
    });
    trace.timing.totalMs = Date.now() - startMs;
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
      decisionTrace: trace,
    });
    return "unmatched";
  }

  // Record assignment in the trace
  trace.nodesTraversed.push({
    nodeId: node.id,
    nodeType: node.type,
    label: node.label,
    outcome: "ASSIGNED",
    assignee: {
      type: assignee.assignmentType,
      assigneeName: assignee.assigneeName,
      assigneeId: assignee.assigneeId,
      teamId: assignee.teamId,
      teamName: assignee.teamName,
    },
  });
  trace.assignment = {
    type: assignee.assignmentType,
    assigneeName: assignee.assigneeName,
    assigneeId: assignee.assigneeId,
    teamId: assignee.teamId,
    teamName: assignee.teamName,
  };
  trace.timing.totalMs = Date.now() - startMs;

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
    decisionTrace: trace,
  });

  if (flow.isDryRun) return "dry_run";

  // Update owner in Salesforce
  try {
    const { updateOwner } = await import("@lead-routing/sfdc");
    const conn = await getOrgConnection(orgId);
    const sObjectName = toSfdcObjectName(objectType);
    await updateOwner(conn, sObjectName, recordId, assignee.sfdcOwnerId);
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
  decisionTrace?: FlowDecisionTrace;
}

async function logFlowRouting(params: FlowLogParams): Promise<void> {
  try {
    await prisma.routingLog.create({
      data: {
        orgId: params.orgId,
        flowId: params.flowId,
        crmRecordId: params.recordId,
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
        decisionTrace: params.decisionTrace ? (params.decisionTrace as any) : null,
      },
    });
  } catch (err) {
    console.error("[flow-router] Failed to create routing log:", err);
  }
}
