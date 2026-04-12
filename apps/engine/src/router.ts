import { prisma } from "@lead-routing/db";
import { updateOwner, mergeLead } from "@lead-routing/sfdc";
import { getActiveRules, type CachedRule, type CachedBranch, type CachedMatchConfig } from "./cache.js";
import { evaluateRule, evaluateRuleDetailed } from "./evaluator.js";
import type { DetailedConditionGroup } from "./evaluator.js";
import { getNextMember, getNextWeightedMember } from "./round-robin.js";
import type { WeightedTeamMember } from "./round-robin.js";
import { getOrgConnection, getSfdcUserId, getSfdcQueueId, evictOrgConnection } from "./sfdc.js";
import { updateHubSpotRecordOwner, evictOrgHubSpotClient } from "./hubspot-connection.js";
import { enqueueRetry } from "./queue.js";
import { fireWebhook } from "./webhook.js";
import { updateAggregates, createConversionTracking } from "./aggregate.js";
import { stripPii } from "./lib/strip-pii.js";
import { normalizeCompanyName, fuzzyCompanyMatch } from "./lib/fuzzy.js";
import { checkAliasCache, cacheAliasResult } from "./lib/alias-cache.js";
import { resolveCompanySimilarity } from "./lib/ai-client.js";
import { setCooldown, isInCooldown } from "./cooldown.js";
import { getRoutingMode } from "./flow-cache.js";

// ─── Decision Trace types ─────────────────────────────────────────────────

export interface TraceMatchCheck {
  objectType: string;
  matchField: string;
  found: boolean;
  matchedRecordId?: string;
}

export interface TraceSplitPath {
  label: string;
  matched: boolean;
  conditionGroups: DetailedConditionGroup[];
  nestedSplits?: TraceSplit[];
}

export interface TraceSplit {
  paths: TraceSplitPath[];
}

export interface TraceRuleEval {
  ruleId: string;
  ruleName: string;
  priority: number;
  outcome: "MATCHED" | "UNMATCHED" | "SKIPPED_TRIGGER_EVENT" | "SKIPPED_TRIGGER_CRITERIA";
  matchPhase?: {
    config: Record<string, unknown>;
    checks: TraceMatchCheck[];
    result: { matched: boolean; matchedType?: string; action?: string };
  };
  branches?: Array<{
    branchId: string;
    label: string;
    priority: number;
    matched: boolean;
    conditionGroups: DetailedConditionGroup[];
    splitTraces?: TraceSplit[];
  }>;
  legacyConditions?: DetailedConditionGroup[];
  defaultOwner?: { evaluated: boolean; resolved: boolean };
}

export interface DecisionTrace {
  version: 1;
  trigger: { event: string; objectType: string; recordId: string; timestampMs: number };
  cooldown?: { checked: true; skipped: boolean };
  rulesEvaluated: TraceRuleEval[];
  fieldUpdates?: Array<{ field: string; value: string }>;
  assignment?: {
    type: string;
    assigneeName: string;
    assigneeId: string;
    teamId?: string;
    teamName?: string;
    roundRobinDetail?: { teamMemberCount: number; selectedIndex: number };
    source: string;
    branchLabel?: string;
  };
  timing: {
    totalMs: number;
    cooldownCheckMs?: number;
    matchPhaseMs?: number;
    evaluationMs?: number;
    assignmentMs?: number;
    sfdcUpdateMs?: number;
  };
}

export function createTrace(payload: { eventType: string; objectType: string; recordId: string }): DecisionTrace {
  return {
    version: 1,
    trigger: {
      event: payload.eventType,
      objectType: payload.objectType,
      recordId: payload.recordId,
      timestampMs: Date.now(),
    },
    rulesEvaluated: [],
    timing: { totalMs: 0 },
  };
}

// ─── Payload type ─────────────────────────────────────────────────────────

export interface RoutingPayload {
  orgId: string;
  objectType: "LEAD" | "CONTACT" | "ACCOUNT" | "COMPANY" | "DEAL";
  eventType: "INSERT" | "UPDATE" | "BOTH" | "SEARCH";
  recordId: string;
  timestamp: string;
  fields: Record<string, unknown>;
  /** When set, only evaluate this specific rule (used by scheduled route runs) */
  ruleId?: string;
  /** Pre-resolved match result from batch matcher (bulk search only) */
  preResolvedMatch?: { type: string; ownerId: string; recordId: string; action?: string } | null;
  /** When true, skip CRM updateOwner call — collect assignments instead for bulk write */
  skipSfdcWrite?: boolean;
  /** Mutable array populated when skipSfdcWrite is true — caller reads assignments after routeRecord returns */
  _assignments?: Array<{ recordId: string; ownerId: string; logId: string }>;
}

export type RoutingResult = "routed" | "unmatched" | "dry_run" | "merged";

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Capitalise first letter only: LEAD → Lead */
function toSfdcObjectName(objectType: string): string {
  return objectType.charAt(0) + objectType.slice(1).toLowerCase();
}

/** Convert internal objectType to CRM API object name. For SFDC: "Lead", for HubSpot: "CONTACT" */
async function toCrmObjectName(orgId: string, objectType: string): Promise<string> {
  const crmType = await getOrgCrmType(orgId);
  if (crmType === "HUBSPOT") return objectType; // HubSpot uses uppercase: CONTACT, COMPANY, DEAL
  return toSfdcObjectName(objectType); // SFDC uses Pascal: Lead, Contact, Account
}

/** Per-org CRM type cache to avoid repeated DB lookups during a single routing cycle */
const orgCrmTypeCache = new Map<string, string>();

async function getOrgCrmType(orgId: string): Promise<string> {
  if (orgCrmTypeCache.has(orgId)) return orgCrmTypeCache.get(orgId)!;
  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { crmType: true },
    });
    const crmType = org?.crmType ?? "SALESFORCE";
    orgCrmTypeCache.set(orgId, crmType);
    return crmType;
  } catch {
    // If the query fails (e.g. in test mocks), default to SALESFORCE
    return "SALESFORCE";
  }
}

/**
 * CRM-agnostic owner update: routes to SFDC jsforce or HubSpot API.
 * For SFDC: uses jsforce connection + updateOwner from @lead-routing/sfdc
 * For HubSpot: uses hubspot-connection.ts updateHubSpotRecordOwner
 */
async function crmUpdateOwner(
  orgId: string,
  objectType: string,
  recordId: string,
  ownerId: string,
  actionField?: string
): Promise<void> {
  const crmType = await getOrgCrmType(orgId);
  if (crmType === "HUBSPOT") {
    await updateHubSpotRecordOwner(orgId, objectType, recordId, ownerId);
  } else {
    const conn = await getOrgConnection(orgId);
    await updateOwner(conn, toSfdcObjectName(objectType), recordId, ownerId, actionField);
  }
}

/** Evict the CRM connection cache for an org (SFDC or HubSpot). */
async function evictCrmConnection(orgId: string): Promise<void> {
  // Evict both — one will be a no-op since only one cache will have an entry
  evictOrgConnection(orgId);
  evictOrgHubSpotClient(orgId);
  orgCrmTypeCache.delete(orgId);
}

// ─── Condition flattening helper ──────────────────────────────────────────────

/** Flatten ConditionGroup[] (from Route Builder) to flat EvalCondition[] for evaluateRule */
export function flattenConditionGroups(rawConditions: any[]): Array<{ groupId: string; fieldName: string; fieldType: string; operator: string; value: string | null }> {
  if (!Array.isArray(rawConditions) || rawConditions.length === 0) return [];
  return rawConditions.flatMap((g: any) => {
    if (Array.isArray(g?.conditions)) {
      // ConditionGroup format: { id, conjunction, conditions: [{fieldApiName, operator, value}] }
      return g.conditions.map((c: any) => ({
        groupId: g.id ?? g.groupId ?? "default",
        fieldName: c.fieldApiName ?? c.fieldName,
        fieldType: c.fieldType ?? "TEXT",
        operator: c.operator,
        value: c.value ?? null,
      }));
    }
    // Flat condition format: { groupId, fieldName, operator, value }
    if (g.fieldName || g.fieldApiName) {
      return [{
        groupId: g.groupId ?? "default",
        fieldName: g.fieldApiName ?? g.fieldName,
        fieldType: g.fieldType ?? "TEXT",
        operator: g.operator,
        value: g.value ?? null,
      }];
    }
    return [];
  });
}

// ─── Recursive step execution for nested splits ──────────────────────────────

export interface StepExecContext {
  fields: Record<string, unknown>;
  recordId: string;
  objectType: string;
  orgId: string;
  isDryRun: boolean;
}

interface StepTraceContext {
  splitTraces: TraceSplit[];
}

interface StepExecResult {
  assignmentType: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  pendingFieldUpdates?: Record<string, string>;
}

/**
 * Recursively execute a steps[] array. Handles filter, updateField, createTask,
 * assign, and split (with nested sub-paths up to any depth).
 *
 * Returns assignment info from the first "assign" step encountered (at any depth),
 * or null if no assign step was reached.
 */
export async function executeSteps(
  steps: any[],
  ctx: StepExecContext,
  traceCtx?: StepTraceContext
): Promise<StepExecResult | null> {
  const pendingFieldUpdates: Record<string, string> = {};
  for (const step of steps) {
    switch (step.type) {
      case "filter":
        // Filter conditions are evaluated by the caller before entering this path — skip
        continue;

      case "updateField": {
        // Build properties map from fieldUpdates array or legacy single-field format
        const fieldUpdates = (step as any).fieldUpdates as Array<{ fieldApiName: string; fieldValue: string }> | undefined;
        const properties: Record<string, string> = {};

        if (fieldUpdates && fieldUpdates.length > 0) {
          for (const fu of fieldUpdates) {
            if (fu.fieldApiName && fu.fieldValue !== undefined) {
              properties[fu.fieldApiName] = String(fu.fieldValue);
            }
          }
        } else if (step.fieldApiName) {
          // Legacy single-field format
          properties[step.fieldApiName as string] = String(step.fieldValue ?? "");
        }

        if (Object.keys(properties).length > 0) {
          if (ctx.isDryRun) {
            // Collect for batched write later (bulk routing)
            Object.assign(pendingFieldUpdates, properties);
          } else {
            try {
              const crmType = await getOrgCrmType(ctx.orgId);
              if (crmType === "HUBSPOT") {
                const { updateHubSpotRecordProperties } = await import("./hubspot-connection.js");
                await updateHubSpotRecordProperties(ctx.orgId, ctx.objectType, ctx.recordId, properties);
              } else {
                const conn = await getOrgConnection(ctx.orgId);
                await conn
                  .sobject(toSfdcObjectName(ctx.objectType))
                  .update({ Id: ctx.recordId, ...properties });
              }
            } catch (err) {
              console.error(`[router] UPDATE_FIELD step failed for ${ctx.recordId}:`, err);
            }
          }
        }
        continue;
      }

      case "createTask":
        if (!ctx.isDryRun) {
          try {
            const crmType = await getOrgCrmType(ctx.orgId);
            if (crmType === "HUBSPOT") {
              // HubSpot: create task via engagements API is complex;
              // for now, log a warning — task creation is SFDC-only
              console.warn(`[router] CREATE_TASK step not yet supported for HubSpot, skipping for ${ctx.recordId}`);
            } else {
            const conn = await getOrgConnection(ctx.orgId);
            const taskData: Record<string, unknown> = {
              Subject: step.subject ?? "",
              Priority: (step.priority as string) ?? "Normal",
              Status: (step.status as string) ?? "Not Started",
              Description: (step.description as string) ?? "",
            };
            if (ctx.objectType === "LEAD" || ctx.objectType === "CONTACT") {
              taskData.WhoId = ctx.recordId;
            } else {
              taskData.WhatId = ctx.recordId;
            }
            if (step.dueDateOffset) {
              const due = new Date();
              due.setDate(due.getDate() + Number(step.dueDateOffset));
              taskData.ActivityDate = due.toISOString().split("T")[0];
            }
            await conn.sobject("Task").create(taskData);
            }
          } catch (err) {
            console.error(`[router] CREATE_TASK step failed for ${ctx.recordId}:`, err);
          }
        }
        continue;

      case "assign":
        // Return assignment info — the caller handles the actual CRM owner update
        return {
          assignmentType: step.assignmentType ?? null,
          assigneeId: step.assigneeId ?? null,
          assigneeName: step.assigneeName ?? null,
          ...(Object.keys(pendingFieldUpdates).length > 0 ? { pendingFieldUpdates } : {}),
        };

      case "split": {
        const splitPaths: any[] = step.paths ?? [];
        let splitResult: StepExecResult | null = null;
        const splitTrace: TraceSplit = { paths: [] };

        for (const subPath of splitPaths) {
          const subSteps: any[] = subPath.steps ?? [];

          // Evaluate the sub-path's filter conditions from steps[0] (single source of truth)
          const filterStep = subSteps.find((s: any) => s.type === "filter");
          const rawConditions = filterStep?.conditions ?? [];
          const flatConditions = flattenConditionGroups(rawConditions);

          let matched = true;
          let conditionGroups: DetailedConditionGroup[] = [];

          if (flatConditions.length > 0) {
            const evalResult = await evaluateRuleDetailed(ctx.fields, flatConditions, ctx.orgId);
            matched = evalResult.matched;
            conditionGroups = evalResult.groups;
            if (!matched) {
              splitTrace.paths.push({ label: subPath.label ?? "Sub-path", matched: false, conditionGroups });
              continue;
            }
          }

          // Sub-path matched — recursively execute its steps
          const subTraceCtx: StepTraceContext = { splitTraces: [] };
          const result = await executeSteps(subSteps, ctx, subTraceCtx);

          splitTrace.paths.push({
            label: subPath.label ?? "Sub-path",
            matched: true,
            conditionGroups,
            nestedSplits: subTraceCtx.splitTraces.length > 0 ? subTraceCtx.splitTraces : undefined,
          });

          if (result) {
            splitResult = result;
            break; // first matching sub-path with an assignment wins
          }
          // Sub-path matched filter but had no assign → keep trying other paths
        }

        // Record this split's trace
        if (traceCtx) traceCtx.splitTraces.push(splitTrace);

        // If a sub-path returned an assignment, propagate it up
        if (splitResult) return splitResult;

        // No sub-path produced an assignment — check for split-level default owner
        if (step.defaultOwner?.assignmentType) {
          return {
            assignmentType: step.defaultOwner.assignmentType ?? null,
            assigneeId: step.defaultOwner.assigneeId ?? null,
            assigneeName: step.defaultOwner.assigneeName ?? null,
          };
        }
        continue;
      }
    }
  }

  return null; // no assign step found
}

// ─── End recursive step execution ────────────────────────────────────────────

interface AssigneeInfo {
  sfdcOwnerId: string;
  assigneeId: string;   // internal DB ID (for logging)
  assigneeName: string;
  assignmentType: string;
  teamId?: string;
  teamName?: string;
}

export async function resolveAssigneeFromFields(
  assignmentType: string,
  assigneeUserId: string | null,
  assigneeTeamId: string | null,
  assigneeQueueId: string | null,
  orgId: string
): Promise<AssigneeInfo | null> {
  if (assignmentType === "USER" && assigneeUserId) {
    const sfdcId = await getSfdcUserId(assigneeUserId);
    const user = await prisma.user.findUnique({
      where: { id: assigneeUserId },
      select: { name: true },
    });
    return {
      sfdcOwnerId: sfdcId,
      assigneeId: assigneeUserId,
      assigneeName: user?.name ?? sfdcId,
      assignmentType: "USER",
    };
  }

  if (assignmentType === "ROUND_ROBIN" && assigneeTeamId) {
    const [activeMembers, team] = await Promise.all([
      prisma.teamMember.findMany({
        where: { teamId: assigneeTeamId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, crmUserId: true, name: true, email: true } } },
      }),
      prisma.roundRobinTeam.findUnique({
        where: { id: assigneeTeamId },
        select: { id: true, name: true, distributionType: true },
      }),
    ]);

    if (activeMembers.length === 0) return null;

    const members = activeMembers.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      assignmentCount: m.assignmentCount,
      weight: (m as any).weight ?? 1,
    }));

    const next = team?.distributionType === "weighted"
      ? await getNextWeightedMember(orgId, assigneeTeamId, members as WeightedTeamMember[])
      : await getNextMember(orgId, assigneeTeamId, members);
    if (!next) return null;

    await prisma.teamMember.update({
      where: { id: next.id },
      data: { assignmentCount: { increment: 1 } },
    });

    await prisma.user.update({
      where: { id: next.userId },
      data: { lastRoutedAt: new Date() },
    });

    const sfdcId = activeMembers.find((m) => m.userId === next.userId)!.user.crmUserId;

    return {
      sfdcOwnerId: sfdcId,
      assigneeId: next.userId,
      assigneeName: next.name,
      assignmentType: "ROUND_ROBIN",
      teamId: team?.id,
      teamName: team?.name,
    };
  }

  if (assignmentType === "QUEUE" && assigneeQueueId) {
    const sfdcId = await getSfdcQueueId(assigneeQueueId);
    const queue = await prisma.sfdcQueue.findUnique({
      where: { id: assigneeQueueId },
      select: { name: true },
    });
    return {
      sfdcOwnerId: sfdcId,
      assigneeId: assigneeQueueId,
      assigneeName: queue?.name ?? sfdcId,
      assignmentType: "QUEUE",
    };
  }

  return null;
}

async function resolveAssignee(rule: CachedRule): Promise<AssigneeInfo | null> {
  return resolveAssigneeFromFields(
    rule.assignmentType ?? "",
    rule.assigneeUserId,
    rule.assigneeTeamId,
    rule.assigneeQueueId,
    rule.orgId
  );
}

async function resolveBranchAssignee(branch: CachedBranch, orgId: string): Promise<AssigneeInfo | null> {
  return resolveAssigneeFromFields(
    branch.assignmentType ?? "",
    branch.assigneeUserId,
    branch.assigneeTeamId,
    branch.assigneeQueueId,
    orgId
  );
}

// ─── Match step helpers ───────────────────────────────────────────────────

export interface MatchResult {
  type: "LEAD" | "CONTACT" | "ACCOUNT";
  ownerId: string;   // SFDC OwnerId of the matched record
  recordId: string;  // SFDC Id of the matched record
}

/**
 * Find a matching Salesforce record (Lead / Contact / Account) for the incoming record.
 * Returns null if no match found.
 */
export async function runMatcher(
  fields: Record<string, unknown>,
  matchConfig: CachedMatchConfig,
  conn: any,
  currentRecordId: string,
  orgId: string
): Promise<MatchResult | null> {
  const email = String(fields["Email"] ?? fields["email"] ?? "").toLowerCase().trim();
  const phone = String(fields["Phone"] ?? fields["phone"] ?? fields["MobilePhone"] ?? "").trim();
  const company = String(fields["Company"] ?? fields["company"] ?? "").trim();

  const emailDomain = email.includes("@") ? email.split("@")[1] : null;

  // Helper: parameterised query via jsforce .sobject().findOne() — no raw SOQL
  async function findFirst(
    objectName: string,
    conditions: Record<string, unknown>,
    excludeId?: string
  ): Promise<{ Id: string; OwnerId: string } | null> {
    try {
      const where = { ...conditions };
      if (excludeId) {
        where.Id = { $ne: excludeId };
      }
      const record = await conn.sobject(objectName).findOne(where, ['Id', 'OwnerId']);
      return record ? (record as { Id: string; OwnerId: string }) : null;
    } catch (err) {
      console.error("[matcher] Query error:", err);
      return null;
    }
  }

  // 1. Check Leads
  if (matchConfig.checkLeads && email) {
    const lead = await findFirst('Lead', { Email: email, IsConverted: false }, currentRecordId);
    if (lead) return { type: "LEAD", ownerId: lead.OwnerId, recordId: lead.Id };
  }

  // 2. Check Contacts
  if (matchConfig.checkContacts && email) {
    const contact = await findFirst('Contact', { Email: email });
    if (contact) return { type: "CONTACT", ownerId: contact.OwnerId, recordId: contact.Id };
  }

  // 3. Check Accounts by domain
  if (matchConfig.checkAccounts && matchConfig.matchDomain && emailDomain) {
    const account = await findFirst('Account', { Website: { $like: `%${emailDomain}%` } });
    if (account) return { type: "ACCOUNT", ownerId: account.OwnerId, recordId: account.Id };
  }

  // Phone-based checks
  if (matchConfig.matchPhone && phone) {
    if (matchConfig.checkLeads) {
      const lead = await findFirst('Lead', { Phone: phone, IsConverted: false }, currentRecordId);
      if (lead) return { type: "LEAD", ownerId: lead.OwnerId, recordId: lead.Id };
    }
    if (matchConfig.checkContacts) {
      const contact = await findFirst('Contact', { Phone: phone });
      if (contact) return { type: "CONTACT", ownerId: contact.OwnerId, recordId: contact.Id };
    }
  }

  // 4. Company name matching (if configured)
  if (matchConfig.matchCompanyName && company) {
    const searchPrefix = company.substring(0, 5).replace(/'/g, "\\'");
    let candidates: Array<{ Id: string; OwnerId: string; Name: string }> = [];
    try {
      const result = await conn.query(
        `SELECT Id, OwnerId, Name FROM Account WHERE Name LIKE '%${searchPrefix}%' LIMIT 20`
      );
      candidates = (result.records ?? []) as Array<{ Id: string; OwnerId: string; Name: string }>;
    } catch (err) {
      console.error("[matcher] Company name SOQL query error:", err);
    }

    for (const candidate of candidates) {
      let isMatch = false;

      if (matchConfig.fuzzyMatchMode === "STRICT") {
        // Exact normalized match
        isMatch = normalizeCompanyName(company) === normalizeCompanyName(candidate.Name);
      } else if (matchConfig.fuzzyMatchMode === "FUZZY") {
        // Fuzzy match: similarity >= 0.8 OR known abbreviation
        const result = fuzzyCompanyMatch(company, candidate.Name);
        isMatch = result.match;
      } else if (matchConfig.fuzzyMatchMode === "AI_SMART") {
        // AI-powered: alias cache → AI call → fallback to fuzzy
        const cached = await checkAliasCache(orgId, company, candidate.Name);
        if (cached !== null) {
          isMatch = cached;
        } else {
          const aiResult = await resolveCompanySimilarity(orgId, company, candidate.Name);
          if (aiResult) {
            await cacheAliasResult(orgId, company, candidate.Name, aiResult.isSimilar, aiResult.confidence);
            isMatch = aiResult.isSimilar;
          } else {
            // AI not configured or errored, fallback to fuzzy
            const result = fuzzyCompanyMatch(company, candidate.Name);
            isMatch = result.match;
          }
        }
      }

      if (isMatch) {
        return {
          type: "ACCOUNT" as const,
          recordId: candidate.Id,
          ownerId: candidate.OwnerId,
        };
      }
    }
  }

  return null;
}

// ─── Main router ─────────────────────────────────────────────────────────

/** Namespace-prefixed Routing_Action__c field for the managed package */
const ROUTING_ACTION_FIELD = "lrt__Routing_Action__c";

export async function routeRecord(payload: RoutingPayload, startMs?: number): Promise<RoutingResult> {
  const { orgId, objectType, eventType: rawEventType, recordId, fields, ruleId: targetRuleId } = payload;
  // Cast to `any` because "SEARCH" isn't in the Prisma TriggerEvent enum yet (schema not regenerated)
  const eventType = rawEventType as any;
  const routeStartMs = startMs ?? Date.now();

  // ── Check if this org+object uses FLOW mode ────────────────────────────
  const routingMode = getRoutingMode(orgId, objectType);
  if (routingMode === "FLOW") {
    const { routeFlowRecord } = await import("./flow-router.js");
    return routeFlowRecord(payload, routeStartMs);
  }

  const trace = createTrace(payload);

  // ── Layer 3: Cooldown check for UPDATE events ──────────────────────────
  if (eventType === "UPDATE") {
    const cooldownStart = Date.now();
    const cooled = await isInCooldown(orgId, recordId);
    trace.cooldown = { checked: true, skipped: cooled };
    trace.timing.cooldownCheckMs = Date.now() - cooldownStart;
    if (cooled) {
      trace.timing.totalMs = Date.now() - routeStartMs;
      await prisma.routingLog.create({
        data: {
          orgId,
          crmRecordId: recordId,
          objectType,
          eventType,
          status: "COOLDOWN_SKIPPED" as any,
          routingDurationMs: startMs ? Date.now() - startMs : null,
          recordSnapshot: stripPii(fields) as any,
          decisionTrace: trace as any,
        },
      });
      return "unmatched";
    }
  }

  const rules = getActiveRules(orgId, objectType);

  // Filter by trigger event — track skipped rules in trace
  const eligibleRules: CachedRule[] = [];
  for (const r of rules) {
    // When targetRuleId is set (scheduled run), only evaluate that specific rule
    if (targetRuleId && r.id !== targetRuleId) {
      trace.rulesEvaluated.push({
        ruleId: r.id, ruleName: r.name, priority: r.priority,
        outcome: "SKIPPED_TRIGGER_EVENT",
      });
      continue;
    }

    if (eventType === "SEARCH") {
      // SEARCH events only match SCHEDULED rules — skip trigger event check
      // (the search criteria already filtered the records before they got here)
      if ((r as any).routeType === "SCHEDULED" || targetRuleId) {
        eligibleRules.push(r);
      } else {
        trace.rulesEvaluated.push({
          ruleId: r.id, ruleName: r.name, priority: r.priority,
          outcome: "SKIPPED_TRIGGER_EVENT",
        });
      }
    } else if (r.triggerEvent === "BOTH" || r.triggerEvent === eventType) {
      // Evaluate trigger conditions — if the rule has trigger criteria,
      // the record must match them before the rule is considered eligible
      if (r.triggerConditions && r.triggerConditions.length > 0) {
        const triggerMatch = await evaluateRule(fields, r.triggerConditions, orgId);
        if (!triggerMatch) {
          trace.rulesEvaluated.push({
            ruleId: r.id, ruleName: r.name, priority: r.priority,
            outcome: "SKIPPED_TRIGGER_CRITERIA",
          });
          continue;
        }
      }
      eligibleRules.push(r);
    } else {
      trace.rulesEvaluated.push({
        ruleId: r.id, ruleName: r.name, priority: r.priority,
        outcome: "SKIPPED_TRIGGER_EVENT",
      });
    }
  }

  // Helper: finalize trace and attach to the most recent routing log
  async function attachTrace() {
    trace.timing.totalMs = Date.now() - routeStartMs;
    try {
      const latestLog = await prisma.routingLog.findFirst({
        where: { orgId, crmRecordId: recordId },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestLog) {
        await prisma.routingLog.update({
          where: { id: latestLog.id },
          data: { decisionTrace: trace as any },
        });
      }
    } catch (e) {
      console.error("[router] Failed to attach decision trace:", e);
    }
  }

  for (const rule of eligibleRules) {
    const isNewStyle = rule.branches.length > 0 || rule.matchConfig !== null || rule.defaultOwnerType !== null;

    if (isNewStyle) {
      const result = await routeNewStyle(rule, payload, startMs, trace);
      if (result !== null) {
        await attachTrace();
        return result;
      }
    } else {
      // Legacy routing: evaluate conditions + single assignee
      const evalStart = Date.now();
      const evalResult = await evaluateRuleDetailed(fields, rule.conditions, orgId);
      trace.timing.evaluationMs = (trace.timing.evaluationMs ?? 0) + (Date.now() - evalStart);

      if (evalResult.matched) {
        trace.rulesEvaluated.push({
          ruleId: rule.id, ruleName: rule.name, priority: rule.priority,
          outcome: "MATCHED", legacyConditions: evalResult.groups,
        });
        const result = await routeLegacy(rule, payload, startMs, trace);
        if (result !== null) {
          await attachTrace();
          return result;
        }
      } else {
        trace.rulesEvaluated.push({
          ruleId: rule.id, ruleName: rule.name, priority: rule.priority,
          outcome: "UNMATCHED", legacyConditions: evalResult.groups,
        });
      }
    }
  }

  // No rule matched at all
  trace.timing.totalMs = Date.now() - routeStartMs;
  await prisma.routingLog.create({
    data: {
      orgId,
      crmRecordId: recordId,
      objectType,
      eventType,
      status: "UNMATCHED",
      routingDurationMs: startMs ? Date.now() - startMs : null,
      recordSnapshot: stripPii(fields) as any,
      decisionTrace: trace as any,
    },
  });
  updateAggregates({
    orgId, date: new Date(), ruleId: null, pathLabel: null, branchId: null,
    teamId: null, assigneeId: null, objectType, status: "UNMATCHED",
    durationMs: startMs ? Date.now() - startMs : null,
  }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
  return "unmatched";
}

// ─── New-style routing (Route Builder) ───────────────────────────────────

async function routeNewStyle(
  rule: CachedRule,
  payload: RoutingPayload,
  startMs?: number,
  trace?: DecisionTrace
): Promise<RoutingResult | null> {
  const { orgId, objectType, eventType: rawEventType, recordId, fields } = payload;
  const eventType = rawEventType as any;
  const ruleTrace: TraceRuleEval = {
    ruleId: rule.id, ruleName: rule.name, priority: rule.priority,
    outcome: "UNMATCHED",
  };
  // Push early — ruleTrace is mutated in place, so trace always has latest state
  if (trace) trace.rulesEvaluated.push(ruleTrace);

  // Step 1: Match step (optional — SFDC only, HubSpot uses Search API instead)
  const orgCrmType = await getOrgCrmType(orgId);
  if (rule.matchConfig && orgCrmType !== "HUBSPOT") {
    let conn: any;
    try {
      conn = await getOrgConnection(orgId);
    } catch {
      console.error(`[router] Could not get SFDC connection for match step, skipping match`);
    }

    if (conn) {
      const matchStart = Date.now();
      const matchResult = payload.preResolvedMatch !== undefined
        ? payload.preResolvedMatch
        : await runMatcher(fields, rule.matchConfig, conn, recordId, orgId);
      if (trace) trace.timing.matchPhaseMs = (trace.timing.matchPhaseMs ?? 0) + (Date.now() - matchStart);

      // Build match trace
      const mc = rule.matchConfig;
      ruleTrace.matchPhase = {
        config: {
          checkLeads: mc.checkLeads, checkContacts: mc.checkContacts,
          checkAccounts: mc.checkAccounts, matchEmail: mc.matchEmail,
          matchPhone: mc.matchPhone, matchDomain: mc.matchDomain,
          matchCompanyName: mc.matchCompanyName, fuzzyMatchMode: mc.fuzzyMatchMode,
        },
        checks: [],
        result: { matched: !!matchResult, matchedType: matchResult?.type, action: undefined },
      };

      if (matchResult) {
        ruleTrace.outcome = "MATCHED";
        const mc = rule.matchConfig;

        // ── Lead matched ──
        if (matchResult.type === "LEAD") {
          if (mc.onLeadMatch === "SFDC_MERGE") {
            if (!rule.isDryRun) {
              try {
                await mergeLead(conn, matchResult.recordId, recordId);
              } catch (err) {
                console.error(`[router] Lead merge failed:`, err);
                await prisma.routingLog.create({
                  data: {
                    orgId, crmRecordId: recordId, objectType, eventType,
                    ruleId: rule.id, ruleName: rule.name,
                    status: "FAILED", errorMessage: String(err),
                    routingDurationMs: startMs ? Date.now() - startMs : null,
                    isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
                  },
                });
                updateAggregates({
                  orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
                  teamId: null, assigneeId: null, objectType, status: "FAILED",
                  durationMs: startMs ? Date.now() - startMs : null,
                }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
                return "unmatched";
              }
            }
            const mergeLog = await prisma.routingLog.create({
              data: {
                orgId, crmRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                status: "MERGED", routingDurationMs: startMs ? Date.now() - startMs : null,
                isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
              },
            });
            updateAggregates({
              orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
              teamId: null, assigneeId: null, objectType, status: "MERGED",
              durationMs: startMs ? Date.now() - startMs : null,
            }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
            return "merged";
          }

          if (mc.onLeadMatch === "ASSIGN_TO_OWNER") {
            if (!rule.isDryRun) {
              await setCooldown(orgId, recordId);
              if (payload.skipSfdcWrite) {
                // defer — will be written in bulk
              } else {
                await crmUpdateOwner(orgId, objectType, recordId, matchResult.ownerId, ROUTING_ACTION_FIELD);
              }
            }
            const leadOwnerLog = await prisma.routingLog.create({
              data: {
                orgId, crmRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                assigneeId: matchResult.ownerId, assigneeName: "Matched Lead Owner",
                status: (!rule.isDryRun && payload.skipSfdcWrite) ? "RETRY" : "SUCCESS",
                routingDurationMs: startMs ? Date.now() - startMs : null,
                isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
              },
            });
            if (!rule.isDryRun && payload.skipSfdcWrite) {
              payload._assignments?.push({ recordId, ownerId: matchResult.ownerId, logId: leadOwnerLog.id });
            }
            updateAggregates({
              orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
              teamId: null, assigneeId: matchResult.ownerId, objectType, status: "SUCCESS",
              durationMs: startMs ? Date.now() - startMs : null,
            }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
            if (objectType === "LEAD") {
              createConversionTracking({
                orgId, routingLogId: leadOwnerLog.id, crmRecordId: recordId,
                ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                teamId: null, assigneeId: matchResult.ownerId, assigneeName: "Matched Lead Owner",
              }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
            }
            return "routed";
          }

          if (mc.onLeadMatch === "ASSIGN_CUSTOM" && mc.leadAssignmentType) {
            const assignee = await resolveAssigneeFromFields(
              mc.leadAssignmentType, mc.leadAssigneeUserId, mc.leadAssigneeTeamId, mc.leadAssigneeQueueId, orgId
            );
            if (assignee) {
              if (!rule.isDryRun) {
                await setCooldown(orgId, recordId);
                if (payload.skipSfdcWrite) {
                  // defer — will be written in bulk
                } else {
                  await crmUpdateOwner(orgId, objectType, recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
                }
              }
              const leadCustomLog = await prisma.routingLog.create({
                data: {
                  orgId, crmRecordId: recordId, objectType, eventType,
                  ruleId: rule.id, ruleName: rule.name,
                  assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                  assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
                  teamId: assignee.teamId, teamName: assignee.teamName,
                  status: (!rule.isDryRun && payload.skipSfdcWrite) ? "RETRY" : "SUCCESS",
                  routingDurationMs: startMs ? Date.now() - startMs : null,
                  isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
                },
              });
              if (!rule.isDryRun && payload.skipSfdcWrite) {
                payload._assignments?.push({ recordId, ownerId: assignee.sfdcOwnerId, logId: leadCustomLog.id });
              }
              updateAggregates({
                orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
                teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
                durationMs: startMs ? Date.now() - startMs : null,
              }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
              if (objectType === "LEAD") {
                createConversionTracking({
                  orgId, routingLogId: leadCustomLog.id, crmRecordId: recordId,
                  ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                  teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
              }
              return "routed";
            }
          }
        }

        // ── Contact matched ──
        if (matchResult.type === "CONTACT") {
          if (mc.onContactMatch === "ASSIGN_TO_OWNER") {
            if (!rule.isDryRun) {
              await setCooldown(orgId, recordId);
              if (payload.skipSfdcWrite) {
                // defer — will be written in bulk
              } else {
                await crmUpdateOwner(orgId, objectType, recordId, matchResult.ownerId, ROUTING_ACTION_FIELD);
              }
            }
            const contactOwnerLog = await prisma.routingLog.create({
              data: {
                orgId, crmRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                assigneeId: matchResult.ownerId, assigneeName: "Matched Contact Owner",
                status: (!rule.isDryRun && payload.skipSfdcWrite) ? "RETRY" : "SUCCESS",
                routingDurationMs: startMs ? Date.now() - startMs : null,
                isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
              },
            });
            if (!rule.isDryRun && payload.skipSfdcWrite) {
              payload._assignments?.push({ recordId, ownerId: matchResult.ownerId, logId: contactOwnerLog.id });
            }
            updateAggregates({
              orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
              teamId: null, assigneeId: matchResult.ownerId, objectType, status: "SUCCESS",
              durationMs: startMs ? Date.now() - startMs : null,
            }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
            if (objectType === "LEAD") {
              createConversionTracking({
                orgId, routingLogId: contactOwnerLog.id, crmRecordId: recordId,
                ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                teamId: null, assigneeId: matchResult.ownerId, assigneeName: "Matched Contact Owner",
              }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
            }
            return "routed";
          }

          if (mc.onContactMatch === "ASSIGN_CUSTOM" && mc.contactAssignmentType) {
            const assignee = await resolveAssigneeFromFields(
              mc.contactAssignmentType, mc.contactAssigneeUserId, mc.contactAssigneeTeamId, mc.contactAssigneeQueueId, orgId
            );
            if (assignee) {
              if (!rule.isDryRun) {
                await setCooldown(orgId, recordId);
                if (payload.skipSfdcWrite) {
                  // defer — will be written in bulk
                } else {
                  await crmUpdateOwner(orgId, objectType, recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
                }
              }
              const contactCustomLog = await prisma.routingLog.create({
                data: {
                  orgId, crmRecordId: recordId, objectType, eventType,
                  ruleId: rule.id, ruleName: rule.name,
                  assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                  assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
                  teamId: assignee.teamId, teamName: assignee.teamName,
                  status: (!rule.isDryRun && payload.skipSfdcWrite) ? "RETRY" : "SUCCESS",
                  routingDurationMs: startMs ? Date.now() - startMs : null,
                  isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
                },
              });
              if (!rule.isDryRun && payload.skipSfdcWrite) {
                payload._assignments?.push({ recordId, ownerId: assignee.sfdcOwnerId, logId: contactCustomLog.id });
              }
              updateAggregates({
                orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
                teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
                durationMs: startMs ? Date.now() - startMs : null,
              }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
              if (objectType === "LEAD") {
                createConversionTracking({
                  orgId, routingLogId: contactCustomLog.id, crmRecordId: recordId,
                  ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                  teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
              }
              return "routed";
            }
          }
          // SKIP → fall through to branch evaluation
        }

        // ── Account matched ──
        if (matchResult.type === "ACCOUNT") {
          if (mc.onAccountMatch === "ASSIGN_TO_OWNER") {
            if (!rule.isDryRun) {
              await setCooldown(orgId, recordId);
              if (payload.skipSfdcWrite) {
                // defer — will be written in bulk
              } else {
                await crmUpdateOwner(orgId, objectType, recordId, matchResult.ownerId, ROUTING_ACTION_FIELD);
              }
            }
            const accountOwnerLog = await prisma.routingLog.create({
              data: {
                orgId, crmRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                assigneeId: matchResult.ownerId, assigneeName: "Matched Account Owner",
                status: (!rule.isDryRun && payload.skipSfdcWrite) ? "RETRY" : "SUCCESS",
                routingDurationMs: startMs ? Date.now() - startMs : null,
                isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
              },
            });
            if (!rule.isDryRun && payload.skipSfdcWrite) {
              payload._assignments?.push({ recordId, ownerId: matchResult.ownerId, logId: accountOwnerLog.id });
            }
            updateAggregates({
              orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
              teamId: null, assigneeId: matchResult.ownerId, objectType, status: "SUCCESS",
              durationMs: startMs ? Date.now() - startMs : null,
            }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
            if (objectType === "LEAD") {
              createConversionTracking({
                orgId, routingLogId: accountOwnerLog.id, crmRecordId: recordId,
                ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                teamId: null, assigneeId: matchResult.ownerId, assigneeName: "Matched Account Owner",
              }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
            }
            return "routed";
          }

          if (mc.onAccountMatch === "ASSIGN_CUSTOM" && mc.accountAssignmentType) {
            const assignee = await resolveAssigneeFromFields(
              mc.accountAssignmentType, mc.accountAssigneeUserId, mc.accountAssigneeTeamId, mc.accountAssigneeQueueId, orgId
            );
            if (assignee) {
              if (!rule.isDryRun) {
                await setCooldown(orgId, recordId);
                if (payload.skipSfdcWrite) {
                  // defer — will be written in bulk
                } else {
                  await crmUpdateOwner(orgId, objectType, recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
                }
              }
              const accountCustomLog = await prisma.routingLog.create({
                data: {
                  orgId, crmRecordId: recordId, objectType, eventType,
                  ruleId: rule.id, ruleName: rule.name,
                  assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                  assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
                  teamId: assignee.teamId, teamName: assignee.teamName,
                  status: (!rule.isDryRun && payload.skipSfdcWrite) ? "RETRY" : "SUCCESS",
                  routingDurationMs: startMs ? Date.now() - startMs : null,
                  isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
                },
              });
              if (!rule.isDryRun && payload.skipSfdcWrite) {
                payload._assignments?.push({ recordId, ownerId: assignee.sfdcOwnerId, logId: accountCustomLog.id });
              }
              updateAggregates({
                orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
                teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
                durationMs: startMs ? Date.now() - startMs : null,
              }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
              if (objectType === "LEAD") {
                createConversionTracking({
                  orgId, routingLogId: accountCustomLog.id, crmRecordId: recordId,
                  ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                  teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
              }
              return "routed";
            }
          }
          // SKIP → fall through
        }
      }
    }
  }

  // Step 2: Branch (path) evaluation
  ruleTrace.branches = [];
  for (const branch of rule.branches) {
    const branchLabel = branch.label || `Path ${rule.branches.indexOf(branch) + 1}`;
    const hasV2Steps = branch.steps && branch.steps.length > 0;

    // V2 branches: skip legacy branch.conditions — the filter is inside steps[0]
    // V1 branches: evaluate legacy branch.conditions as before
    const evalStart = Date.now();
    let evalResult: { matched: boolean; groups: DetailedConditionGroup[] };

    if (hasV2Steps) {
      // For V2 branches, evaluate the first filter step's conditions
      const firstFilterStep = branch.steps!.find((s: any) => s.type === "filter");
      const flatConditions = flattenConditionGroups(firstFilterStep?.conditions ?? []);
      evalResult = flatConditions.length > 0
        ? await evaluateRuleDetailed(fields, flatConditions, orgId)
        : { matched: true, groups: [] }; // no conditions = catch-all
    } else {
      evalResult = await evaluateRuleDetailed(fields, branch.conditions, orgId);
    }

    if (trace) trace.timing.evaluationMs = (trace.timing.evaluationMs ?? 0) + (Date.now() - evalStart);

    ruleTrace.branches!.push({
      branchId: branch.id,
      label: branchLabel,
      priority: branch.priority,
      matched: evalResult.matched,
      conditionGroups: evalResult.groups,
    });

    if (evalResult.matched) {
      ruleTrace.outcome = "MATCHED";

      // ── Multi-step branch execution (recursive — handles nested splits) ──
      if (hasV2Steps) {
        const branchTraceCtx: StepTraceContext = { splitTraces: [] };
        const stepResult = await executeSteps(branch.steps, {
          fields,
          recordId,
          objectType,
          orgId,
          isDryRun: rule.isDryRun,
        }, branchTraceCtx);
        // Attach split traces to the branch trace for the UI
        const branchTraceEntry = ruleTrace.branches?.[ruleTrace.branches.length - 1];
        if (branchTraceEntry && branchTraceCtx.splitTraces.length > 0) {
          branchTraceEntry.splitTraces = branchTraceCtx.splitTraces;
        }
        // If a nested assign step returned assignment info, use it to override branch-level assignment
        // (This allows nested splits to determine the final assignee)
        if (stepResult?.assignmentType) {
          // Resolve the assignee from the step result
          const nestedAssignee = await resolveAssigneeFromFields(
            stepResult.assignmentType,
            stepResult.assignmentType === "USER" ? stepResult.assigneeId : null,
            stepResult.assignmentType === "ROUND_ROBIN" ? stepResult.assigneeId : null,
            stepResult.assignmentType === "QUEUE" ? stepResult.assigneeId : null,
            orgId,
          );
          if (nestedAssignee) {
            // Use the nested assignee instead of the branch-level one
            const branchLabel = branch.label || `Path ${rule.branches.indexOf(branch) + 1}`;
            const log = await prisma.routingLog.create({
              data: {
                orgId, crmRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                pathLabel: branchLabel, branchId: branch.id,
                assigneeId: nestedAssignee.sfdcOwnerId, assigneeName: nestedAssignee.assigneeName,
                assignmentType: nestedAssignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
                teamId: nestedAssignee.teamId, teamName: nestedAssignee.teamName,
                isDryRun: rule.isDryRun, status: "RETRY",
                routingDurationMs: startMs ? Date.now() - startMs : null,
                recordSnapshot: stripPii(fields) as any,
              },
            });

            if (!rule.isDryRun) {
              try {
                await setCooldown(orgId, recordId);
                await crmUpdateOwner(orgId, objectType, recordId, nestedAssignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
                await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
                fireWebhook(orgId, {
                  event: `${objectType}_ROUTED`,
                  ruleId: rule.id,
                  ruleName: rule.name,
                  recordId,
                  assignee: nestedAssignee,
                });
              } catch (err: any) {
                console.error(`[router] nested assignment failed for ${recordId}:`, err);
                await prisma.routingLog.update({ where: { id: log.id }, data: { status: "FAILED", errorMessage: err?.message ?? String(err) } });
              }
            } else {
              await prisma.routingLog.update({ where: { id: log.id }, data: { status: "UNMATCHED", errorMessage: "Dry run — no assignment made" } });
            }
            return { matched: true, trace: ruleTrace };
          }
        }
      }

      const assignee = await resolveBranchAssignee(branch, orgId);
      if (!assignee) continue; // branch has no eligible assignee, try next

      const branchLabel = branch.label || `Path ${rule.branches.indexOf(branch) + 1}`;
      const log = await prisma.routingLog.create({
        data: {
          orgId, crmRecordId: recordId, objectType, eventType,
          ruleId: rule.id, ruleName: rule.name,
          pathLabel: branchLabel, branchId: branch.id,
          assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
          teamId: assignee.teamId, teamName: assignee.teamName,
          isDryRun: rule.isDryRun, status: "RETRY",
          routingDurationMs: startMs ? Date.now() - startMs : null,
          recordSnapshot: stripPii(fields) as any,
        },
      });

      if (rule.isDryRun) {
        await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
        updateAggregates({
          orgId, date: new Date(), ruleId: rule.id, pathLabel: branchLabel, branchId: branch.id,
          teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
          durationMs: startMs ? Date.now() - startMs : null,
        }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        if (objectType === "LEAD") {
          createConversionTracking({
            orgId, routingLogId: log.id, crmRecordId: recordId,
            ruleId: rule.id, ruleName: rule.name, pathLabel: branchLabel,
            teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        }
        return "dry_run";
      }

      if (payload.skipSfdcWrite) {
        await setCooldown(orgId, recordId);
        payload._assignments?.push({ recordId, ownerId: assignee.sfdcOwnerId, logId: log.id });
        updateAggregates({
          orgId, date: new Date(), ruleId: rule.id, pathLabel: branchLabel, branchId: branch.id,
          teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
          durationMs: startMs ? Date.now() - startMs : null,
        }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        if (objectType === "LEAD") {
          createConversionTracking({
            orgId, routingLogId: log.id, crmRecordId: recordId,
            ruleId: rule.id, ruleName: rule.name, pathLabel: branchLabel,
            teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        }
        return "routed";
      }

      try {
        await setCooldown(orgId, recordId);
        await crmUpdateOwner(orgId, objectType, recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
        await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
        updateAggregates({
          orgId, date: new Date(), ruleId: rule.id, pathLabel: branchLabel, branchId: branch.id,
          teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
          durationMs: startMs ? Date.now() - startMs : null,
        }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        if (objectType === "LEAD") {
          createConversionTracking({
            orgId, routingLogId: log.id, crmRecordId: recordId,
            ruleId: rule.id, ruleName: rule.name, pathLabel: branchLabel,
            teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        }
        fireWebhook(orgId, {
          event: `${objectType}_ROUTED`,
          recordId, objectType,
          assigneeName: assignee.assigneeName,
          assigneeId: assignee.assigneeId,
          ruleName: rule.name, ruleId: rule.id,
          timestamp: new Date().toISOString(),
        });
        return "routed";
      } catch (err) {
        await evictCrmConnection(orgId);
        await enqueueRetry({
          logId: log.id, orgId, recordId,
          objectType: await toCrmObjectName(orgId, objectType),
          ownerId: assignee.sfdcOwnerId,
        });
        console.error(`[router] CRM update failed for ${recordId}, enqueued for retry:`, err);
        return "routed";
      }
    }
  }

  // Step 3: Default owner catch-all
  if (rule.defaultOwnerType) {
    const assignee = await resolveAssigneeFromFields(
      rule.defaultOwnerType,
      rule.defaultOwnerUserId,
      rule.defaultOwnerTeamId,
      rule.defaultOwnerQueueId,
      orgId
    );
    ruleTrace.defaultOwner = { evaluated: true, resolved: !!assignee };

    if (assignee) {
      ruleTrace.outcome = "MATCHED";
      const log = await prisma.routingLog.create({
        data: {
          orgId, crmRecordId: recordId, objectType, eventType,
          ruleId: rule.id, ruleName: rule.name,
          pathLabel: "Default Owner",
          assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
          teamId: assignee.teamId, teamName: assignee.teamName,
          isDryRun: rule.isDryRun, status: "RETRY",
          routingDurationMs: startMs ? Date.now() - startMs : null,
          recordSnapshot: stripPii(fields) as any,
        },
      });

      if (rule.isDryRun) {
        await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
        updateAggregates({
          orgId, date: new Date(), ruleId: rule.id, pathLabel: "Default Owner", branchId: null,
          teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
          durationMs: startMs ? Date.now() - startMs : null,
        }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        if (objectType === "LEAD") {
          createConversionTracking({
            orgId, routingLogId: log.id, crmRecordId: recordId,
            ruleId: rule.id, ruleName: rule.name, pathLabel: "Default Owner",
            teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        }
        return "dry_run";
      }

      if (payload.skipSfdcWrite) {
        await setCooldown(orgId, recordId);
        payload._assignments?.push({ recordId, ownerId: assignee.sfdcOwnerId, logId: log.id });
        updateAggregates({
          orgId, date: new Date(), ruleId: rule.id, pathLabel: "Default Owner", branchId: null,
          teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
          durationMs: startMs ? Date.now() - startMs : null,
        }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        if (objectType === "LEAD") {
          createConversionTracking({
            orgId, routingLogId: log.id, crmRecordId: recordId,
            ruleId: rule.id, ruleName: rule.name, pathLabel: "Default Owner",
            teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        }
        return "routed";
      }

      try {
        await setCooldown(orgId, recordId);
        await crmUpdateOwner(orgId, objectType, recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
        await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
        updateAggregates({
          orgId, date: new Date(), ruleId: rule.id, pathLabel: "Default Owner", branchId: null,
          teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
          durationMs: startMs ? Date.now() - startMs : null,
        }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        if (objectType === "LEAD") {
          createConversionTracking({
            orgId, routingLogId: log.id, crmRecordId: recordId,
            ruleId: rule.id, ruleName: rule.name, pathLabel: "Default Owner",
            teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
        }
        return "routed";
      } catch (err) {
        await evictCrmConnection(orgId);
        await enqueueRetry({
          logId: log.id, orgId, recordId,
          objectType: await toCrmObjectName(orgId, objectType),
          ownerId: assignee.sfdcOwnerId,
        });
        return "routed";
      }
    }
  }

  // New-style rule with no matching branch and no default owner → UNMATCHED
  await prisma.routingLog.create({
    data: {
      orgId, crmRecordId: recordId, objectType, eventType,
      ruleId: rule.id, ruleName: rule.name,
      status: "UNMATCHED", routingDurationMs: startMs ? Date.now() - startMs : null,
      isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
    },
  });
  updateAggregates({
    orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
    teamId: null, assigneeId: null, objectType, status: "UNMATCHED",
    durationMs: startMs ? Date.now() - startMs : null,
  }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
  return "unmatched";
}

// ─── Legacy routing ───────────────────────────────────────────────────────

async function routeLegacy(
  rule: CachedRule,
  payload: RoutingPayload,
  startMs?: number,
  trace?: DecisionTrace
): Promise<RoutingResult | null> {
  const { orgId, objectType, eventType: rawEventType, recordId, fields } = payload;
  const eventType = rawEventType as any;

  const assignee = await resolveAssignee(rule);
  if (trace && assignee) {
    trace.assignment = {
      type: assignee.assignmentType,
      assigneeName: assignee.assigneeName,
      assigneeId: assignee.sfdcOwnerId,
      teamId: assignee.teamId,
      teamName: assignee.teamName,
      source: "LEGACY",
    };
  }
  if (!assignee) {
    await prisma.routingLog.create({
      data: {
        orgId, crmRecordId: recordId, objectType, eventType,
        ruleId: rule.id, ruleName: rule.name,
        status: "FAILED", errorMessage: "No eligible assignee found",
        routingDurationMs: startMs ? Date.now() - startMs : null,
        isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
      },
    });
    updateAggregates({
      orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
      teamId: null, assigneeId: null, objectType, status: "FAILED",
      durationMs: startMs ? Date.now() - startMs : null,
    }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
    return "unmatched";
  }

  const log = await prisma.routingLog.create({
    data: {
      orgId, crmRecordId: recordId, objectType, eventType,
      ruleId: rule.id, ruleName: rule.name,
      assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
      assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
      teamId: assignee.teamId, teamName: assignee.teamName,
      isDryRun: rule.isDryRun, status: "RETRY",
      routingDurationMs: startMs ? Date.now() - startMs : null,
      recordSnapshot: stripPii(fields) as any,
    },
  });

  if (rule.isDryRun) {
    await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
    updateAggregates({
      orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
      teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
      durationMs: startMs ? Date.now() - startMs : null,
    }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
    if (objectType === "LEAD") {
      createConversionTracking({
        orgId, routingLogId: log.id, crmRecordId: recordId,
        ruleId: rule.id, ruleName: rule.name, pathLabel: null,
        teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
      }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
    }
    return "dry_run";
  }

  if (payload.skipSfdcWrite) {
    await setCooldown(orgId, recordId);
    payload._assignments?.push({ recordId, ownerId: assignee.sfdcOwnerId, logId: log.id });
    updateAggregates({
      orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
      teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
      durationMs: startMs ? Date.now() - startMs : null,
    }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
    if (objectType === "LEAD") {
      createConversionTracking({
        orgId, routingLogId: log.id, crmRecordId: recordId,
        ruleId: rule.id, ruleName: rule.name, pathLabel: null,
        teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
      }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
    }
    return "routed";
  }

  try {
    await setCooldown(orgId, recordId);
    await crmUpdateOwner(orgId, objectType, recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
    await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
    updateAggregates({
      orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
      teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
      durationMs: startMs ? Date.now() - startMs : null,
    }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
    if (objectType === "LEAD") {
      createConversionTracking({
        orgId, routingLogId: log.id, crmRecordId: recordId,
        ruleId: rule.id, ruleName: rule.name, pathLabel: null,
        teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
      }).catch((err) => { console.error("[router] background task failed:", err?.message ?? err); });
    }
    fireWebhook(orgId, {
      event: `${objectType}_ROUTED`,
      recordId, objectType,
      assigneeName: assignee.assigneeName,
      assigneeId: assignee.assigneeId,
      ruleName: rule.name, ruleId: rule.id,
      timestamp: new Date().toISOString(),
    });
    return "routed";
  } catch (err) {
    await evictCrmConnection(orgId);
    await enqueueRetry({
      logId: log.id, orgId, recordId,
      objectType: await toCrmObjectName(orgId, objectType),
      ownerId: assignee.sfdcOwnerId,
    });
    console.error(`[router] CRM update failed for ${recordId}, enqueued for retry:`, err);
    return "routed";
  }
}
