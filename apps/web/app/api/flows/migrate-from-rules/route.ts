import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { autoLayout } from "@/components/flow-builder/flow-auto-layout";
import type {
  FlowNodeData,
  FlowEdgeData,
  TriggerEvent,
  AssignmentType,
  FuzzyMatchMode,
} from "@/components/flow-builder/types";
import type { ConditionGroup, Condition } from "@/components/condition-builder/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

let edgeCounter = 0;

function makeEdge(
  source: string,
  target: string,
  label?: string,
  sourceHandle?: string,
): FlowEdgeData {
  edgeCounter++;
  return {
    id: `edge-${edgeCounter}`,
    source,
    target,
    label,
    sourceHandle,
  };
}

/** Convert DB trigger conditions into ConditionGroup[] for a decision node */
function dbConditionsToGroups(
  conditions: Array<{
    id: string;
    groupId: string;
    fieldName: string;
    fieldType: string;
    operator: string;
    value: string | null;
    sortOrder: number;
  }>,
): ConditionGroup[] {
  const groupMap = new Map<string, Condition[]>();
  for (const c of conditions) {
    if (!groupMap.has(c.groupId)) groupMap.set(c.groupId, []);
    groupMap.get(c.groupId)!.push({
      id: c.id,
      groupId: c.groupId,
      fieldApiName: c.fieldName,
      fieldType: c.fieldType as Condition["fieldType"],
      operator: c.operator,
      value: c.value ?? "",
    });
  }
  return Array.from(groupMap.entries()).map(([groupId, conds]) => ({
    id: groupId,
    conjunction: "AND" as const,
    conditions: conds.sort((a, b) => {
      const ai = conditions.findIndex((x) => x.id === a.id);
      const bi = conditions.findIndex((x) => x.id === b.id);
      return ai - bi;
    }),
  }));
}

function resolveAssigneeName(branch: {
  assignmentType?: string | null;
  assigneeUser?: { name: string | null } | null;
  assigneeTeam?: { name: string | null } | null;
  assigneeQueue?: { name: string | null } | null;
}): string {
  if (branch.assigneeUser?.name) return branch.assigneeUser.name;
  if (branch.assigneeTeam?.name) return branch.assigneeTeam.name;
  if (branch.assigneeQueue?.name) return branch.assigneeQueue.name;
  return "Unknown";
}

function resolveAssigneeId(branch: {
  assignmentType?: string | null;
  assigneeUserId?: string | null;
  assigneeTeamId?: string | null;
  assigneeQueueId?: string | null;
}): string {
  if (branch.assigneeUserId) return branch.assigneeUserId;
  if (branch.assigneeTeamId) return branch.assigneeTeamId;
  if (branch.assigneeQueueId) return branch.assigneeQueueId;
  return "";
}

// ─── POST handler ───────────────────────────────────────────────────────────

const VALID_OBJECT_TYPES = ["LEAD", "CONTACT", "ACCOUNT"];

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const body = await req.json();
    const { objectType } = body;

    if (!objectType || !VALID_OBJECT_TYPES.includes(objectType)) {
      return NextResponse.json({ error: "Invalid objectType" }, { status: 400 });
    }

    // Load all active rules for this org + object type
    const rules = await prisma.routingRule.findMany({
      where: { orgId, objectType, status: "ACTIVE" },
      orderBy: { priority: "asc" },
      include: {
        triggerConditions: { orderBy: { sortOrder: "asc" } },
        branches: {
          orderBy: { priority: "asc" },
          include: {
            conditions: { orderBy: { sortOrder: "asc" } },
            assigneeUser: { select: { name: true } },
            assigneeTeam: { select: { name: true } },
            assigneeQueue: { select: { name: true } },
          },
        },
        matchConfig: true,
        defaultOwnerUser: { select: { name: true } },
        defaultOwnerTeam: { select: { name: true } },
        defaultOwnerQueue: { select: { name: true } },
      },
    });

    const nodes: FlowNodeData[] = [];
    const edges: FlowEdgeData[] = [];
    const warnings: string[] = [];

    // Reset edge counter for each request
    edgeCounter = 0;

    if (rules.length === 0) {
      return NextResponse.json({
        nodes,
        edges,
        warnings: ["No active rules found for this object type"],
      });
    }

    // ── a. ENTRY node ─────────────────────────────────────────────────────────
    const triggerEvents = new Set(rules.map((r) => r.triggerEvent));
    let triggerEvent: TriggerEvent = "BOTH";
    if (triggerEvents.size === 1) {
      triggerEvent = [...triggerEvents][0] as TriggerEvent;
    }

    const entryNode: FlowNodeData = {
      id: "entry-1",
      type: "ENTRY",
      label: "Record Enters",
      position: { x: 400, y: 0 },
      config: {
        triggerEvent,
        triggerConditions: [],
      },
    };
    nodes.push(entryNode);

    if (triggerEvents.size > 1) {
      warnings.push(
        "Rules had mixed trigger events (INSERT / UPDATE). Entry node set to BOTH.",
      );
    }

    // ── b. Chain rules sequentially ───────────────────────────────────────────
    let currentParentId = entryNode.id;
    let currentEdgeLabel: string | undefined = undefined;
    let currentSourceHandle: string | undefined = undefined;
    let yOffset = 120;

    for (let ri = 0; ri < rules.length; ri++) {
      const rule = rules[ri];
      const ruleTag = `rule${ri}`;

      // Track where the "true" path starts for this rule
      let trueParentId = currentParentId;
      let trueEdgeLabel: string | undefined = currentEdgeLabel;
      let trueSourceHandle: string | undefined = currentSourceHandle;

      // ── i. Trigger conditions → DECISION node ────────────────────────────
      if (rule.triggerConditions.length > 0) {
        const condGroups = dbConditionsToGroups(rule.triggerConditions);
        const decisionId = `decision-${ruleTag}-trigger`;
        const decisionNode: FlowNodeData = {
          id: decisionId,
          type: "DECISION",
          label: `${rule.name} — Trigger Filter`,
          position: { x: 400, y: yOffset },
          config: { conditions: condGroups },
        };
        nodes.push(decisionNode);
        edges.push(makeEdge(currentParentId, decisionId, currentEdgeLabel, currentSourceHandle));
        yOffset += 200;

        // True branch continues to this rule's content
        trueParentId = decisionId;
        trueEdgeLabel = "True";
        trueSourceHandle = "true";

        // False branch chains to the next rule
        currentParentId = decisionId;
        currentEdgeLabel = "False";
        currentSourceHandle = "false";
      }

      // ── ii. Match config → MATCH node ────────────────────────────────────
      if (rule.matchConfig) {
        const mc = rule.matchConfig;
        const matchId = `match-${ruleTag}`;
        const matchNode: FlowNodeData = {
          id: matchId,
          type: "MATCH",
          label: `${rule.name} — Match`,
          position: { x: 400, y: yOffset },
          config: {
            checkLeads: mc.checkLeads,
            checkContacts: mc.checkContacts,
            checkAccounts: mc.checkAccounts,
            matchEmail: mc.matchEmail,
            matchPhone: mc.matchPhone,
            matchDomain: mc.matchDomain,
            matchCompanyName: mc.matchCompanyName,
            fuzzyMatchMode: mc.fuzzyMatchMode as FuzzyMatchMode,
          },
        };
        nodes.push(matchNode);
        edges.push(makeEdge(trueParentId, matchId, trueEdgeLabel, trueSourceHandle));
        yOffset += 160;

        // After match node, branches come off the "found" handle
        trueParentId = matchId;
        trueEdgeLabel = "Found";
        trueSourceHandle = "found";

        // "Not Found" path goes to default or next rule
        // We'll handle this after branches — track it
        const notFoundParentId = matchId;
        const notFoundHandle = "not-found";

        // If there's a default owner, connect not-found → default
        if (rule.defaultOwnerType) {
          const defaultId = `default-${ruleTag}-notfound`;
          const defaultName =
            rule.defaultOwnerUser?.name ??
            rule.defaultOwnerTeam?.name ??
            rule.defaultOwnerQueue?.name ??
            "Unknown";
          const defaultNode: FlowNodeData = {
            id: defaultId,
            type: "DEFAULT",
            label: `Default — ${defaultName}`,
            position: { x: 200, y: yOffset },
            config: {
              assignmentType: rule.defaultOwnerType as AssignmentType,
              assigneeId:
                rule.defaultOwnerUserId ??
                rule.defaultOwnerTeamId ??
                rule.defaultOwnerQueueId ??
                "",
              assigneeName: defaultName,
            },
          };
          nodes.push(defaultNode);
          edges.push(makeEdge(notFoundParentId, defaultId, "Not Found", notFoundHandle));
        } else {
          warnings.push(
            `Rule "${rule.name}" has a Match node but no default owner for the Not Found path.`,
          );
        }
      }

      // ── iii. Branches → DECISION + ASSIGNMENT nodes ──────────────────────
      const sortedBranches = [...rule.branches].sort((a, b) => a.priority - b.priority);
      let branchParentId = trueParentId;
      let branchEdgeLabel: string | undefined = trueEdgeLabel;
      let branchSourceHandle: string | undefined = trueSourceHandle;

      for (let bi = 0; bi < sortedBranches.length; bi++) {
        const branch = sortedBranches[bi];
        const branchTag = `${ruleTag}-branch${bi}`;

        if (branch.conditions.length > 0) {
          // Branch has conditions → DECISION node
          const condGroups = dbConditionsToGroups(branch.conditions);
          const branchDecisionId = `decision-${branchTag}`;
          const branchDecisionNode: FlowNodeData = {
            id: branchDecisionId,
            type: "DECISION",
            label: branch.label ?? `Branch ${bi + 1} Condition`,
            position: { x: 400, y: yOffset },
            config: { conditions: condGroups },
          };
          nodes.push(branchDecisionNode);
          edges.push(
            makeEdge(branchParentId, branchDecisionId, branchEdgeLabel, branchSourceHandle),
          );
          yOffset += 200;

          // True → ASSIGNMENT
          if (branch.assignmentType) {
            const assignId = `assign-${branchTag}`;
            const assignNode: FlowNodeData = {
              id: assignId,
              type: "ASSIGNMENT",
              label: `Assign — ${resolveAssigneeName(branch)}`,
              position: { x: 600, y: yOffset },
              config: {
                assignmentType: branch.assignmentType as AssignmentType,
                assigneeId: resolveAssigneeId(branch),
                assigneeName: resolveAssigneeName(branch),
              },
            };
            nodes.push(assignNode);
            edges.push(makeEdge(branchDecisionId, assignId, "True", "true"));
            yOffset += 120;
          }

          // False → next branch
          branchParentId = branchDecisionId;
          branchEdgeLabel = "False";
          branchSourceHandle = "false";
        } else {
          // No conditions — catch-all branch → ASSIGNMENT directly
          if (branch.assignmentType) {
            const assignId = `assign-${branchTag}`;
            const assignNode: FlowNodeData = {
              id: assignId,
              type: "ASSIGNMENT",
              label: `Assign — ${resolveAssigneeName(branch)}`,
              position: { x: 400, y: yOffset },
              config: {
                assignmentType: branch.assignmentType as AssignmentType,
                assigneeId: resolveAssigneeId(branch),
                assigneeName: resolveAssigneeName(branch),
              },
            };
            nodes.push(assignNode);
            edges.push(makeEdge(branchParentId, assignId, branchEdgeLabel, branchSourceHandle));
            yOffset += 120;

            // After a catch-all, reset branch chaining
            branchParentId = assignId;
            branchEdgeLabel = undefined;
            branchSourceHandle = undefined;
          }
        }
      }

      // ── iv. Default owner → DEFAULT node (if no match node already handled it) ─
      if (rule.defaultOwnerType && !rule.matchConfig) {
        const defaultId = `default-${ruleTag}`;
        const defaultName =
          rule.defaultOwnerUser?.name ??
          rule.defaultOwnerTeam?.name ??
          rule.defaultOwnerQueue?.name ??
          "Unknown";
        const defaultNode: FlowNodeData = {
          id: defaultId,
          type: "DEFAULT",
          label: `Default — ${defaultName}`,
          position: { x: 400, y: yOffset },
          config: {
            assignmentType: rule.defaultOwnerType as AssignmentType,
            assigneeId:
              rule.defaultOwnerUserId ??
              rule.defaultOwnerTeamId ??
              rule.defaultOwnerQueueId ??
              "",
            assigneeName: defaultName,
          },
        };
        nodes.push(defaultNode);
        edges.push(makeEdge(branchParentId, defaultId, branchEdgeLabel, branchSourceHandle));
        yOffset += 120;
      }

      // ── v. If no trigger conditions, advance currentParent past this rule ─
      // (When there ARE trigger conditions, currentParent was already set to
      //  the decision's False handle above, so the next rule chains correctly.)
      if (rule.triggerConditions.length === 0) {
        // This rule had no gating decision, so the next rule needs a fresh
        // connection point. If there were branches, the last unmatched branch
        // decision's False output is the right parent.
        // If there were no branches at all, we stay on the same parent.
        currentParentId = branchParentId;
        currentEdgeLabel = branchEdgeLabel;
        currentSourceHandle = branchSourceHandle;
      }
    }

    // ── d. Check for dangling unmatched path ──────────────────────────────────
    // If the last rule's false/unmatched path has no assignment, warn
    const leafNodes = nodes.filter(
      (n) =>
        !edges.some((e) => e.source === n.id) && n.id !== "entry-1",
    );
    const hasUnterminatedPath = leafNodes.some(
      (n) => n.type === "DECISION" || n.type === "MATCH",
    );
    if (hasUnterminatedPath) {
      warnings.push(
        "Some decision/match paths have no assignment at the end. Records on those paths will not be routed.",
      );
    }

    // ── 4. Auto-layout ───────────────────────────────────────────────────────
    const layoutedNodes = autoLayout(nodes, edges);

    return NextResponse.json({
      nodes: layoutedNodes,
      edges,
      warnings,
    });
  } catch (err: unknown) {
    console.error("POST /api/flows/migrate-from-rules error:", err);
    if (err instanceof Error && err.message.includes("x-org-id")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
