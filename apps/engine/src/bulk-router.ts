// ─── Bulk Router ──────────────────────────────────────────────────────────────
// High-performance routing for bulk/scheduled runs.
// Separates evaluation (pure CPU) from persistence (batched I/O) to achieve
// ~100x fewer DB round-trips compared to per-record routeRecord().
//
// Flow: Pre-load → Evaluate → Resolve assignments → Batch persist → Return

import { prisma } from "@lead-routing/db";
import { randomUUID } from "crypto";
import { getActiveRules, type CachedRule, type CachedBranch } from "./cache.js";
import { evaluateRuleDetailed, type DetailedConditionGroup } from "./evaluator.js";
import { getNextMember, getNextWeightedMember, type TeamMember, type WeightedTeamMember } from "./round-robin.js";
import { stripPii } from "./lib/strip-pii.js";
import { setCooldownBatch } from "./cooldown.js";
import { updateAggregatesBatch, type AggregateInput } from "./aggregate.js";

// Re-use exported helpers from router.ts
import {
  type DecisionTrace,
  type TraceRuleEval,
  type StepExecContext,
  createTrace,
  flattenConditionGroups,
  executeSteps,
} from "./router.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BulkRoutingInput {
  orgId: string;
  ruleId: string;
  runId: string;
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  records: Array<{
    recordId: string;
    fields: Record<string, unknown>;
  }>;
}

export interface BulkAssignment {
  recordId: string;
  ownerId: string;
  logId: string;
  assigneeName: string | null;
  assignmentType: string | null;
  teamId: string | null;
  teamName: string | null;
}

export interface BulkRoutingOutput {
  assignments: BulkAssignment[];
  routed: number;
  failed: number;
  unmatched: number;
}

interface RoutingDecision {
  recordId: string;
  fields: Record<string, unknown>;
  logId: string; // pre-generated UUID for createMany
  outcome: "routed" | "unmatched" | "failed";
  // Rule info
  ruleId: string;
  ruleName: string;
  branchId: string | null;
  pathLabel: string | null;
  // Assignment info (populated if outcome === "routed")
  assignmentType: string | null;
  assigneeOwnerId: string | null;
  assigneeName: string | null;
  teamId: string | null;
  teamName: string | null;
  stepAssigneeUserId: string | null; // userId from nested step execution (for USER type)
  stepAssigneeQueueId: string | null; // queueId from nested step execution (for QUEUE type)
  // Trace
  decisionTrace: DecisionTrace;
  durationMs: number;
  errorMessage: string | null;
}

// Pre-fetched shared state for the batch
interface SharedState {
  rule: CachedRule;
  teamMembers: Map<string, Array<TeamMember & { crmUserId: string; weight: number }>>;
  teamDistribution: Map<string, string>; // teamId → distributionType
  teamNames: Map<string, string>; // teamId → name
  users: Map<string, { name: string; crmUserId: string }>; // userId → user info
  queues: Map<string, { name: string; sfdcQueueId: string }>; // queueId → queue info
}

// ─── Main function ───────────────────────────────────────────────────────────

export async function bulkRouteRecords(input: BulkRoutingInput): Promise<BulkRoutingOutput> {
  const { orgId, ruleId, objectType, records } = input;
  const batchStartMs = Date.now();

  // ── Phase 1: Pre-load shared state ──────────────────────────────────────
  const state = await preloadState(orgId, ruleId, objectType);
  if (!state) {
    // Rule not found or inactive — mark all as unmatched
    return { assignments: [], routed: 0, failed: 0, unmatched: records.length };
  }

  // ── Phase 2: Evaluate all records (pure, parallel) ──────────────────────
  const decisions = await evaluateAll(records, state, orgId, objectType);

  // ── Phase 3: Resolve assignments (batched Redis) ────────────────────────
  await resolveAssignments(decisions, state, orgId);

  // ── Phase 4: Batch persist ──────────────────────────────────────────────
  await batchPersist(decisions, orgId, objectType, batchStartMs);

  // ── Phase 5: Return assignments for SFDC batch write ───────────────────
  const assignments: BulkAssignment[] = [];
  let routed = 0;
  let failed = 0;
  let unmatched = 0;

  for (const d of decisions) {
    if (d.outcome === "routed" && d.assigneeOwnerId) {
      assignments.push({
        recordId: d.recordId,
        ownerId: d.assigneeOwnerId,
        logId: d.logId,
        assigneeName: d.assigneeName,
        assignmentType: d.assignmentType,
        teamId: d.teamId,
        teamName: d.teamName,
      });
      routed++;
    } else if (d.outcome === "failed") {
      failed++;
    } else {
      unmatched++;
    }
  }

  const elapsed = Date.now() - batchStartMs;
  console.log(`[bulk-router] Batch of ${records.length}: ${routed} routed, ${unmatched} unmatched, ${failed} failed in ${elapsed}ms (${Math.round(records.length / (elapsed / 1000))} rec/sec)`);

  return { assignments, routed, failed, unmatched };
}

// ─── Phase 1: Pre-load shared state ──────────────────────────────────────────

async function preloadState(
  orgId: string,
  ruleId: string,
  objectType: string,
): Promise<SharedState | null> {
  const rules = getActiveRules(orgId, objectType);
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) return null;

  // Collect all team IDs, user IDs, and queue IDs referenced by this rule
  const teamIds = new Set<string>();
  const userIds = new Set<string>();
  const queueIds = new Set<string>();

  // From branches
  for (const branch of rule.branches) {
    if (branch.assigneeTeamId) teamIds.add(branch.assigneeTeamId);
    if (branch.assigneeUserId) userIds.add(branch.assigneeUserId);
    if (branch.assigneeQueueId) queueIds.add(branch.assigneeQueueId);
  }
  // From legacy assignee
  if (rule.assigneeTeamId) teamIds.add(rule.assigneeTeamId);
  if (rule.assigneeUserId) userIds.add(rule.assigneeUserId);
  if (rule.assigneeQueueId) queueIds.add(rule.assigneeQueueId);
  // From default owner
  if (rule.defaultOwnerTeamId) teamIds.add(rule.defaultOwnerTeamId);
  if (rule.defaultOwnerUserId) userIds.add(rule.defaultOwnerUserId);
  if (rule.defaultOwnerQueueId) queueIds.add(rule.defaultOwnerQueueId);

  // Pre-fetch team members, users, and queues in parallel
  const [teamMembersRaw, teamsRaw, usersRaw, queuesRaw] = await Promise.all([
    teamIds.size > 0
      ? prisma.teamMember.findMany({
          where: { teamId: { in: [...teamIds] }, status: "ACTIVE" },
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, crmUserId: true, name: true, email: true } } },
        })
      : [],
    teamIds.size > 0
      ? prisma.roundRobinTeam.findMany({
          where: { id: { in: [...teamIds] } },
          select: { id: true, name: true, distributionType: true },
        })
      : [],
    userIds.size > 0
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, name: true, crmUserId: true },
        })
      : [],
    queueIds.size > 0
      ? prisma.sfdcQueue.findMany({
          where: { id: { in: [...queueIds] } },
          select: { id: true, name: true, sfdcQueueId: true },
        })
      : [],
  ]);

  // Build maps
  const teamMembers = new Map<string, Array<TeamMember & { crmUserId: string; weight: number }>>();
  for (const tm of teamMembersRaw as any[]) {
    if (!teamMembers.has(tm.teamId)) teamMembers.set(tm.teamId, []);
    teamMembers.get(tm.teamId)!.push({
      id: tm.id,
      userId: tm.userId,
      name: tm.user.name,
      email: tm.user.email,
      assignmentCount: tm.assignmentCount,
      crmUserId: tm.user.crmUserId,
      weight: tm.weight ?? 1,
    });
  }

  const teamDistribution = new Map<string, string>();
  const teamNames = new Map<string, string>();
  for (const t of teamsRaw) {
    teamDistribution.set(t.id, t.distributionType);
    teamNames.set(t.id, t.name);
  }

  const users = new Map<string, { name: string; crmUserId: string }>();
  for (const u of usersRaw) {
    users.set(u.id, { name: u.name ?? u.id, crmUserId: u.crmUserId ?? "" });
  }

  const queues = new Map<string, { name: string; sfdcQueueId: string }>();
  for (const q of queuesRaw) {
    queues.set(q.id, { name: q.name, sfdcQueueId: q.sfdcQueueId });
  }

  return { rule, teamMembers, teamDistribution, teamNames, users, queues };
}

// ─── Phase 2: Evaluate all records ───────────────────────────────────────────

async function evaluateAll(
  records: Array<{ recordId: string; fields: Record<string, unknown> }>,
  state: SharedState,
  orgId: string,
  objectType: string,
): Promise<RoutingDecision[]> {
  const { rule } = state;
  const isNewStyle = rule.branches.length > 0 || rule.matchConfig !== null || rule.defaultOwnerType !== null;

  const results = await Promise.allSettled(
    records.map(async (rec): Promise<RoutingDecision> => {
      const startMs = Date.now();
      const trace = createTrace({ eventType: "SEARCH", objectType, recordId: rec.recordId });
      const logId = randomUUID();

      try {
        if (isNewStyle) {
          return evaluateNewStyle(rec, rule, trace, logId, startMs, orgId, objectType);
        } else {
          return evaluateLegacy(rec, rule, trace, logId, startMs, orgId);
        }
      } catch (err: any) {
        trace.timing.totalMs = Date.now() - startMs;
        return {
          recordId: rec.recordId,
          fields: rec.fields,
          logId,
          outcome: "failed",
          ruleId: rule.id,
          ruleName: rule.name,
          branchId: null,
          pathLabel: null,
          assignmentType: null,
          assigneeOwnerId: null,
          assigneeName: null,
          teamId: null,
          teamName: null,
          stepAssigneeUserId: null,
          stepAssigneeQueueId: null,
          decisionTrace: trace,
          durationMs: Date.now() - startMs,
          errorMessage: err.message ?? String(err),
        };
      }
    })
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    // Promise.allSettled rejection — shouldn't happen since we catch inside
    return {
      recordId: records[i].recordId,
      fields: records[i].fields,
      logId: randomUUID(),
      outcome: "failed" as const,
      ruleId: state.rule.id,
      ruleName: state.rule.name,
      branchId: null,
      pathLabel: null,
      assignmentType: null,
      assigneeOwnerId: null,
      assigneeName: null,
      teamId: null,
      teamName: null,
      stepAssigneeUserId: null,
      stepAssigneeQueueId: null,
      decisionTrace: createTrace({ eventType: "SEARCH", objectType, recordId: records[i].recordId }),
      durationMs: 0,
      errorMessage: r.reason?.message ?? "Evaluation failed",
    };
  });
}

function evaluateNewStyle(
  rec: { recordId: string; fields: Record<string, unknown> },
  rule: CachedRule,
  trace: DecisionTrace,
  logId: string,
  startMs: number,
  orgId: string,
  objectType: string,
): Promise<RoutingDecision> {
  return evaluateNewStyleAsync(rec, rule, trace, logId, startMs, orgId, objectType);
}

async function evaluateNewStyleAsync(
  rec: { recordId: string; fields: Record<string, unknown> },
  rule: CachedRule,
  trace: DecisionTrace,
  logId: string,
  startMs: number,
  orgId: string,
  objectType: string,
): Promise<RoutingDecision> {
  const ruleTrace: TraceRuleEval = {
    ruleId: rule.id,
    ruleName: rule.name,
    priority: rule.priority,
    outcome: "UNMATCHED",
    branches: [],
  };
  trace.rulesEvaluated.push(ruleTrace);

  // Evaluate branches in priority order
  for (const branch of rule.branches) {
    const evalStart = Date.now();
    const hasV2Steps = branch.steps && branch.steps.length > 0;

    // Check for updateField/createTask steps — these need per-record CRM calls
    // In bulk mode we skip them (they're extremely rare for scheduled rules)
    const hasIoSteps = hasV2Steps && branch.steps!.some(
      (s: any) => s.type === "updateField" || s.type === "createTask"
    );

    let evalResult: { matched: boolean; groups: DetailedConditionGroup[] };

    if (hasV2Steps && !hasIoSteps) {
      const firstFilterStep = branch.steps!.find((s: any) => s.type === "filter");
      const flatConditions = flattenConditionGroups((firstFilterStep?.conditions ?? []) as any[]);
      evalResult = flatConditions.length > 0
        ? await evaluateRuleDetailed(rec.fields, flatConditions, orgId)
        : { matched: true, groups: [] };
    } else if (hasIoSteps) {
      // Skip branches with I/O steps in bulk mode
      ruleTrace.branches!.push({
        branchId: branch.id,
        label: branch.label ?? `Path`,
        priority: branch.priority,
        matched: false,
        conditionGroups: [],
      });
      continue;
    } else {
      evalResult = await evaluateRuleDetailed(rec.fields, branch.conditions, orgId);
    }

    trace.timing.evaluationMs = (trace.timing.evaluationMs ?? 0) + (Date.now() - evalStart);

    ruleTrace.branches!.push({
      branchId: branch.id,
      label: branch.label ?? `Path`,
      priority: branch.priority,
      matched: evalResult.matched,
      conditionGroups: evalResult.groups,
    });

    if (evalResult.matched) {
      ruleTrace.outcome = "MATCHED";
      const branchLabel = branch.label || `Path ${rule.branches.indexOf(branch) + 1}`;

      // Determine assignment via recursive step execution (handles nested splits)
      let assignmentType = branch.assignmentType;
      let assigneeUserId = branch.assigneeUserId;
      let assigneeTeamId = branch.assigneeTeamId;
      let assigneeQueueId = branch.assigneeQueueId;

      if (hasV2Steps) {
        // Use executeSteps with isDryRun=true to traverse nested splits
        // without performing I/O (updateField, createTask are skipped)
        const stepCtx: StepExecContext = {
          fields: rec.fields,
          recordId: rec.recordId,
          objectType,
          orgId,
          isDryRun: true,
        };
        const stepResult = await executeSteps(branch.steps!, stepCtx);
        if (stepResult) {
          assignmentType = stepResult.assignmentType ?? assignmentType;
          if (stepResult.assignmentType === "USER" && stepResult.assigneeId) {
            assigneeUserId = stepResult.assigneeId;
            assigneeTeamId = null;
            assigneeQueueId = null;
          } else if (stepResult.assignmentType === "ROUND_ROBIN" && stepResult.assigneeId) {
            assigneeTeamId = stepResult.assigneeId;
            assigneeUserId = null;
            assigneeQueueId = null;
          } else if (stepResult.assignmentType === "QUEUE" && stepResult.assigneeId) {
            assigneeQueueId = stepResult.assigneeId;
            assigneeUserId = null;
            assigneeTeamId = null;
          } else {
            // Fallback: try finding top-level assign step
            const assignStep = branch.steps!.find((s: any) => s.type === "assign") as any;
            if (assignStep) {
              assignmentType = assignStep.assignmentType ?? assignmentType;
              assigneeUserId = assignStep.assigneeUserId ?? assigneeUserId;
              assigneeTeamId = assignStep.assigneeTeamId ?? assigneeTeamId;
              assigneeQueueId = assignStep.assigneeQueueId ?? assigneeQueueId;
            }
          }
        }
      }

      trace.timing.totalMs = Date.now() - startMs;
      return {
        recordId: rec.recordId,
        fields: rec.fields,
        logId,
        outcome: "routed",
        ruleId: rule.id,
        ruleName: rule.name,
        branchId: branch.id,
        pathLabel: branchLabel,
        assignmentType: assignmentType,
        assigneeOwnerId: null, // resolved in Phase 3
        assigneeName: null,    // resolved in Phase 3
        teamId: assigneeTeamId,
        teamName: null,        // resolved in Phase 3
        stepAssigneeUserId: assigneeUserId,
        stepAssigneeQueueId: assigneeQueueId,
        decisionTrace: trace,
        durationMs: Date.now() - startMs,
        errorMessage: null,
      };
    }
  }

  // Check default owner
  if (rule.defaultOwnerType) {
    ruleTrace.outcome = "MATCHED";
    ruleTrace.defaultOwner = { evaluated: true, resolved: true };
    trace.timing.totalMs = Date.now() - startMs;

    return {
      recordId: rec.recordId,
      fields: rec.fields,
      logId,
      outcome: "routed",
      ruleId: rule.id,
      ruleName: rule.name,
      branchId: null,
      pathLabel: "Default Owner",
      assignmentType: rule.defaultOwnerType,
      assigneeOwnerId: null,
      assigneeName: null,
      teamId: rule.defaultOwnerTeamId,
      teamName: null,
      stepAssigneeUserId: rule.defaultOwnerUserId ?? null,
      stepAssigneeQueueId: rule.defaultOwnerQueueId ?? null,
      decisionTrace: trace,
      durationMs: Date.now() - startMs,
      errorMessage: null,
    };
  }

  // No branch matched
  trace.timing.totalMs = Date.now() - startMs;
  return {
    recordId: rec.recordId,
    fields: rec.fields,
    logId,
    outcome: "unmatched",
    ruleId: rule.id,
    ruleName: rule.name,
    branchId: null,
    pathLabel: null,
    assignmentType: null,
    assigneeOwnerId: null,
    assigneeName: null,
    teamId: null,
    teamName: null,
    stepAssigneeUserId: null,
    stepAssigneeQueueId: null,
    decisionTrace: trace,
    durationMs: Date.now() - startMs,
    errorMessage: null,
  };
}

async function evaluateLegacy(
  rec: { recordId: string; fields: Record<string, unknown> },
  rule: CachedRule,
  trace: DecisionTrace,
  logId: string,
  startMs: number,
  orgId: string,
): Promise<RoutingDecision> {
  const evalStart = Date.now();
  const evalResult = await evaluateRuleDetailed(rec.fields, rule.conditions, orgId);
  trace.timing.evaluationMs = Date.now() - evalStart;

  trace.rulesEvaluated.push({
    ruleId: rule.id,
    ruleName: rule.name,
    priority: rule.priority,
    outcome: evalResult.matched ? "MATCHED" : "UNMATCHED",
    legacyConditions: evalResult.groups,
  });

  if (evalResult.matched) {
    trace.timing.totalMs = Date.now() - startMs;
    return {
      recordId: rec.recordId,
      fields: rec.fields,
      logId,
      outcome: "routed",
      ruleId: rule.id,
      ruleName: rule.name,
      branchId: null,
      pathLabel: null,
      assignmentType: rule.assignmentType,
      assigneeOwnerId: null,
      assigneeName: null,
      teamId: rule.assigneeTeamId,
      teamName: null,
      stepAssigneeUserId: null,
      stepAssigneeQueueId: rule.assigneeQueueId,
      decisionTrace: trace,
      durationMs: Date.now() - startMs,
      errorMessage: null,
    };
  }

  trace.timing.totalMs = Date.now() - startMs;
  return {
    recordId: rec.recordId,
    fields: rec.fields,
    logId,
    outcome: "unmatched",
    ruleId: rule.id,
    ruleName: rule.name,
    branchId: null,
    pathLabel: null,
    assignmentType: null,
    assigneeOwnerId: null,
    assigneeName: null,
    teamId: null,
    teamName: null,
    stepAssigneeUserId: null,
    stepAssigneeQueueId: null,
    decisionTrace: trace,
    durationMs: Date.now() - startMs,
    errorMessage: null,
  };
}

// ─── Phase 3: Resolve assignments ────────────────────────────────────────────

async function resolveAssignments(
  decisions: RoutingDecision[],
  state: SharedState,
  orgId: string,
): Promise<void> {
  for (const d of decisions) {
    if (d.outcome !== "routed" || !d.assignmentType) continue;

    try {
      if (d.assignmentType === "USER") {
        // Resolve from pre-fetched user cache, with DB fallback for nested step assignments
        const userId = findUserId(d, state.rule);
        if (userId) {
          if (state.users.has(userId)) {
            const user = state.users.get(userId)!;
            d.assigneeOwnerId = user.crmUserId;
            d.assigneeName = user.name;
          } else {
            // Cache miss — user from nested split step, fetch from DB
            const user = await prisma.user.findUnique({
              where: { id: userId },
              select: { name: true, crmUserId: true },
            });
            if (user?.crmUserId) {
              d.assigneeOwnerId = user.crmUserId;
              d.assigneeName = user.name ?? userId;
              // Cache for subsequent records in this batch
              state.users.set(userId, { name: user.name ?? userId, crmUserId: user.crmUserId });
            }
          }
        }
      } else if (d.assignmentType === "ROUND_ROBIN") {
        const teamId = d.teamId;
        if (!teamId) continue;

        // Load team members on demand if not pre-cached (nested split teams)
        if (!state.teamMembers.has(teamId)) {
          const [membersRaw, teamRaw] = await Promise.all([
            prisma.teamMember.findMany({
              where: { teamId, status: "ACTIVE" },
              orderBy: { createdAt: "asc" },
              include: { user: { select: { id: true, crmUserId: true, name: true, email: true } } },
            }),
            prisma.roundRobinTeam.findUnique({
              where: { id: teamId },
              select: { id: true, name: true, distributionType: true },
            }),
          ]);
          const members = (membersRaw as any[]).map((tm) => ({
            id: tm.id,
            userId: tm.userId,
            name: tm.user.name,
            email: tm.user.email,
            assignmentCount: tm.assignmentCount,
            crmUserId: tm.user.crmUserId,
            weight: tm.weight ?? 1,
          }));
          state.teamMembers.set(teamId, members);
          if (teamRaw) {
            state.teamDistribution.set(teamId, teamRaw.distributionType);
            state.teamNames.set(teamId, teamRaw.name);
          }
        }

        const members = state.teamMembers.get(teamId);
        if (!members || members.length === 0) {
          d.outcome = "unmatched";
          continue;
        }

        d.teamName = state.teamNames.get(teamId) ?? null;
        const distType = state.teamDistribution.get(teamId);

        // Round-robin via Redis Lua (atomic, safe for concurrent calls)
        const next = distType === "weighted"
          ? await getNextWeightedMember(orgId, teamId, members as WeightedTeamMember[])
          : await getNextMember(orgId, teamId, members);

        if (!next) {
          d.outcome = "unmatched";
          continue;
        }

        const memberData = members.find((m) => m.userId === next.userId);
        d.assigneeOwnerId = memberData?.crmUserId ?? "";
        d.assigneeName = next.name;
      } else if (d.assignmentType === "QUEUE") {
        // Resolve queue assignment from pre-fetched cache or DB fallback
        const queueId = findQueueId(d, state.rule);
        if (queueId) {
          if (state.queues.has(queueId)) {
            const queue = state.queues.get(queueId)!;
            d.assigneeOwnerId = queue.sfdcQueueId;
            d.assigneeName = queue.name;
          } else {
            // Cache miss — queue from nested split step, fetch from DB
            const queue = await prisma.sfdcQueue.findUnique({
              where: { id: queueId },
              select: { name: true, sfdcQueueId: true },
            });
            if (queue?.sfdcQueueId) {
              d.assigneeOwnerId = queue.sfdcQueueId;
              d.assigneeName = queue.name;
              // Cache for subsequent records in this batch
              state.queues.set(queueId, { name: queue.name, sfdcQueueId: queue.sfdcQueueId });
            }
          }
        }
      }

      // Populate trace assignment info
      if (d.assigneeOwnerId) {
        d.decisionTrace.assignment = {
          type: d.assignmentType,
          assigneeName: d.assigneeName ?? "",
          assigneeId: d.assigneeOwnerId,
          teamId: d.teamId ?? undefined,
          teamName: d.teamName ?? undefined,
          source: d.pathLabel ?? "rule",
          branchLabel: d.pathLabel ?? undefined,
        };
      }
    } catch (err: any) {
      d.outcome = "failed";
      d.errorMessage = `Assignment resolution failed: ${err.message}`;
    }
  }
}

function findUserId(d: RoutingDecision, rule: CachedRule): string | null {
  // Check step-determined user (from nested split execution)
  if (d.stepAssigneeUserId) return d.stepAssigneeUserId;
  // Check if the branch has a specific user
  if (d.branchId) {
    const branch = rule.branches.find((b) => b.id === d.branchId);
    if (branch?.assigneeUserId) return branch.assigneeUserId;
  }
  // Check default owner
  if (d.pathLabel === "Default Owner" && rule.defaultOwnerUserId) {
    return rule.defaultOwnerUserId;
  }
  // Legacy single-assignee
  return rule.assigneeUserId;
}

function findQueueId(d: RoutingDecision, rule: CachedRule): string | null {
  // Check step-determined queue (from nested split execution)
  if (d.stepAssigneeQueueId) return d.stepAssigneeQueueId;
  // Check if the branch has a specific queue
  if (d.branchId) {
    const branch = rule.branches.find((b) => b.id === d.branchId);
    if (branch?.assigneeQueueId) return branch.assigneeQueueId;
  }
  // Check default owner
  if (d.pathLabel === "Default Owner" && rule.defaultOwnerQueueId) {
    return rule.defaultOwnerQueueId;
  }
  // Legacy single-assignee
  return rule.assigneeQueueId;
}

// ─── Phase 4: Batch persist ──────────────────────────────────────────────────

async function batchPersist(
  decisions: RoutingDecision[],
  orgId: string,
  objectType: string,
  batchStartMs: number,
): Promise<void> {
  const eventType = "SEARCH" as any;
  const now = new Date();

  // 1. Batch create routing logs with traces inlined
  //    Assignee fields are left NULL at creation — they're only populated
  //    after a successful SFDC CRM write (Phase B in bulk-search-queue).
  //    This ensures failed writes never show a misleading assignee in the UI.
  const logData = decisions.map((d) => ({
    id: d.logId,
    orgId,
    crmRecordId: d.recordId,
    objectType,
    eventType,
    ruleId: d.outcome !== "unmatched" ? d.ruleId : null,
    ruleName: d.outcome !== "unmatched" ? d.ruleName : null,
    pathLabel: d.pathLabel,
    branchId: d.branchId,
    assigneeId: null,
    assigneeName: null,
    assignmentType: null as any,
    teamId: null,
    teamName: null,
    isDryRun: false,
    status: d.outcome === "routed" ? "RETRY" : d.outcome === "unmatched" ? "UNMATCHED" : "FAILED",
    errorMessage: d.errorMessage,
    routingDurationMs: d.durationMs,
    recordSnapshot: stripPii(d.fields) as any,
    decisionTrace: d.decisionTrace as any,
  }));

  try {
    await prisma.routingLog.createMany({ data: logData });
  } catch (err) {
    // Fallback: if batch fails, try individual creates
    console.error("[bulk-router] createMany failed, falling back to individual creates:", err);
    await Promise.allSettled(logData.map((data) => prisma.routingLog.create({ data })));
  }

  // 2. Batch update team member assignment counts
  const userIdsToUpdate = new Set<string>();

  for (const d of decisions) {
    if (d.outcome !== "routed" || d.assignmentType !== "ROUND_ROBIN" || !d.teamId) continue;
    if (d.assigneeOwnerId) {
      userIdsToUpdate.add(d.assigneeOwnerId);
    }
  }

  // Update user lastRoutedAt for all assigned users
  if (userIdsToUpdate.size > 0) {
    await prisma.user.updateMany({
      where: { crmUserId: { in: [...userIdsToUpdate] } },
      data: { lastRoutedAt: now },
    }).catch(() => {});
  }

  // 3. Batch aggregate updates
  const aggInputs: AggregateInput[] = [];
  for (const d of decisions) {
    aggInputs.push({
      orgId,
      date: now,
      ruleId: d.outcome !== "unmatched" ? d.ruleId : null,
      pathLabel: d.pathLabel ?? null,
      branchId: d.branchId ?? null,
      teamId: d.teamId ?? null,
      assigneeId: d.assigneeOwnerId ?? null,
      objectType: objectType as AggregateInput["objectType"],
      status: d.outcome === "routed" ? "SUCCESS" : d.outcome === "unmatched" ? "UNMATCHED" : "FAILED",
      durationMs: d.durationMs,
    });
  }
  updateAggregatesBatch(aggInputs).catch((err) => {
    console.error("[bulk-router] Aggregate batch failed:", err);
  });

  // 4. Batch cooldown sets
  const cooldownRecordIds = decisions
    .filter((d) => d.outcome === "routed")
    .map((d) => d.recordId);
  setCooldownBatch(orgId, cooldownRecordIds).catch(() => {});

  // 5. Batch conversion tracking (Leads only — track Lead-to-Opportunity conversion)
  if (objectType === "LEAD") {
    const conversionData = decisions
      .filter((d) => d.outcome === "routed")
      .map((d) => ({
        orgId,
        routingLogId: d.logId,
        crmRecordId: d.recordId,
        ruleId: d.ruleId,
        ruleName: d.ruleName,
        pathLabel: d.pathLabel,
        teamId: d.teamId,
        assigneeId: d.assigneeOwnerId,
        assigneeName: d.assigneeName,
      }));

    if (conversionData.length > 0) {
      prisma.conversionTracking.createMany({ data: conversionData }).catch((err) => {
        console.error("[bulk-router] Conversion tracking batch failed:", err);
      });
    }
  }
}
