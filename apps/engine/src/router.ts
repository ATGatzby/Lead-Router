import { prisma } from "@lead-routing/db";
import { updateOwner, mergeLead } from "@lead-routing/sfdc";
import { getActiveRules, type CachedRule, type CachedBranch, type CachedMatchConfig } from "./cache.js";
import { evaluateRule, evaluateRuleDetailed } from "./evaluator.js";
import type { DetailedConditionGroup } from "./evaluator.js";
import { getNextMember, getNextWeightedMember } from "./round-robin.js";
import type { WeightedTeamMember } from "./round-robin.js";
import { getOrgConnection, getSfdcUserId, getSfdcQueueId, evictOrgConnection } from "./sfdc.js";
import { enqueueRetry } from "./queue.js";
import { fireWebhook } from "./webhook.js";
import { updateAggregates, createConversionTracking } from "./aggregate.js";
import { stripPii } from "./lib/strip-pii.js";
import { normalizeCompanyName, fuzzyCompanyMatch } from "./lib/fuzzy.js";
import { checkAliasCache, cacheAliasResult } from "./lib/alias-cache.js";
import { resolveCompanySimilarity } from "./lib/ai-client.js";
import { setCooldown, isInCooldown } from "./cooldown.js";

// ─── Decision Trace types ─────────────────────────────────────────────────

interface TraceMatchCheck {
  objectType: string;
  matchField: string;
  found: boolean;
  matchedRecordId?: string;
}

interface TraceRuleEval {
  ruleId: string;
  ruleName: string;
  priority: number;
  outcome: "MATCHED" | "UNMATCHED" | "SKIPPED_TRIGGER_EVENT";
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
  }>;
  legacyConditions?: DetailedConditionGroup[];
  defaultOwner?: { evaluated: boolean; resolved: boolean };
}

interface DecisionTrace {
  version: 1;
  trigger: { event: string; objectType: string; recordId: string; timestampMs: number };
  cooldown?: { checked: true; skipped: boolean };
  rulesEvaluated: TraceRuleEval[];
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

function createTrace(payload: { eventType: string; objectType: string; recordId: string }): DecisionTrace {
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
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  eventType: "INSERT" | "UPDATE" | "BOTH" | "SEARCH";
  recordId: string;
  timestamp: string;
  fields: Record<string, unknown>;
  /** When set, only evaluate this specific rule (used by scheduled route runs) */
  ruleId?: string;
  /** Pre-resolved match result from batch matcher (bulk search only) */
  preResolvedMatch?: { type: string; ownerId: string; recordId: string; action?: string } | null;
}

export type RoutingResult = "routed" | "unmatched" | "dry_run" | "merged";

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Capitalise first letter only: LEAD → Lead */
function toSfdcObjectName(objectType: string): string {
  return objectType.charAt(0) + objectType.slice(1).toLowerCase();
}

interface AssigneeInfo {
  sfdcOwnerId: string;
  assigneeId: string;   // internal DB ID (for logging)
  assigneeName: string;
  assignmentType: string;
  teamId?: string;
  teamName?: string;
}

async function resolveAssigneeFromFields(
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
        include: { user: { select: { id: true, sfdcUserId: true, name: true, email: true } } },
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

    const sfdcId = activeMembers.find((m) => m.userId === next.userId)!.user.sfdcUserId;

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

interface MatchResult {
  type: "LEAD" | "CONTACT" | "ACCOUNT";
  ownerId: string;   // SFDC OwnerId of the matched record
  recordId: string;  // SFDC Id of the matched record
}

/**
 * Find a matching Salesforce record (Lead / Contact / Account) for the incoming record.
 * Returns null if no match found.
 */
async function runMatcher(
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
  const trace = createTrace(payload);
  const routeStartMs = startMs ?? Date.now();

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
          sfdcRecordId: recordId,
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
        where: { orgId, sfdcRecordId: recordId },
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
      sfdcRecordId: recordId,
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
  }).catch(() => {});
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

  // Step 1: Match step (optional)
  if (rule.matchConfig) {
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
                    orgId, sfdcRecordId: recordId, objectType, eventType,
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
                }).catch(() => {});
                return "unmatched";
              }
            }
            const mergeLog = await prisma.routingLog.create({
              data: {
                orgId, sfdcRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                status: "MERGED", routingDurationMs: startMs ? Date.now() - startMs : null,
                isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
              },
            });
            updateAggregates({
              orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
              teamId: null, assigneeId: null, objectType, status: "MERGED",
              durationMs: startMs ? Date.now() - startMs : null,
            }).catch(() => {});
            return "merged";
          }

          if (mc.onLeadMatch === "ASSIGN_TO_OWNER") {
            if (!rule.isDryRun) {
              await setCooldown(orgId, recordId);
              await updateOwner(conn, toSfdcObjectName(objectType), recordId, matchResult.ownerId, ROUTING_ACTION_FIELD);
            }
            const leadOwnerLog = await prisma.routingLog.create({
              data: {
                orgId, sfdcRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                assigneeId: matchResult.ownerId, assigneeName: "Matched Lead Owner",
                status: "SUCCESS", routingDurationMs: startMs ? Date.now() - startMs : null,
                isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
              },
            });
            updateAggregates({
              orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
              teamId: null, assigneeId: matchResult.ownerId, objectType, status: "SUCCESS",
              durationMs: startMs ? Date.now() - startMs : null,
            }).catch(() => {});
            if (objectType === "LEAD") {
              createConversionTracking({
                orgId, routingLogId: leadOwnerLog.id, sfdcLeadId: recordId,
                ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                teamId: null, assigneeId: matchResult.ownerId, assigneeName: "Matched Lead Owner",
              }).catch(() => {});
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
                await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
              }
              const leadCustomLog = await prisma.routingLog.create({
                data: {
                  orgId, sfdcRecordId: recordId, objectType, eventType,
                  ruleId: rule.id, ruleName: rule.name,
                  assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                  assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
                  teamId: assignee.teamId, teamName: assignee.teamName,
                  status: "SUCCESS", routingDurationMs: startMs ? Date.now() - startMs : null,
                  isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
                },
              });
              updateAggregates({
                orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
                teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
                durationMs: startMs ? Date.now() - startMs : null,
              }).catch(() => {});
              if (objectType === "LEAD") {
                createConversionTracking({
                  orgId, routingLogId: leadCustomLog.id, sfdcLeadId: recordId,
                  ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                  teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                }).catch(() => {});
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
              await updateOwner(conn, toSfdcObjectName(objectType), recordId, matchResult.ownerId, ROUTING_ACTION_FIELD);
            }
            const contactOwnerLog = await prisma.routingLog.create({
              data: {
                orgId, sfdcRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                assigneeId: matchResult.ownerId, assigneeName: "Matched Contact Owner",
                status: "SUCCESS", routingDurationMs: startMs ? Date.now() - startMs : null,
                isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
              },
            });
            updateAggregates({
              orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
              teamId: null, assigneeId: matchResult.ownerId, objectType, status: "SUCCESS",
              durationMs: startMs ? Date.now() - startMs : null,
            }).catch(() => {});
            if (objectType === "LEAD") {
              createConversionTracking({
                orgId, routingLogId: contactOwnerLog.id, sfdcLeadId: recordId,
                ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                teamId: null, assigneeId: matchResult.ownerId, assigneeName: "Matched Contact Owner",
              }).catch(() => {});
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
                await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
              }
              const contactCustomLog = await prisma.routingLog.create({
                data: {
                  orgId, sfdcRecordId: recordId, objectType, eventType,
                  ruleId: rule.id, ruleName: rule.name,
                  assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                  assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
                  teamId: assignee.teamId, teamName: assignee.teamName,
                  status: "SUCCESS", routingDurationMs: startMs ? Date.now() - startMs : null,
                  isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
                },
              });
              updateAggregates({
                orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
                teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
                durationMs: startMs ? Date.now() - startMs : null,
              }).catch(() => {});
              if (objectType === "LEAD") {
                createConversionTracking({
                  orgId, routingLogId: contactCustomLog.id, sfdcLeadId: recordId,
                  ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                  teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                }).catch(() => {});
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
              await updateOwner(conn, toSfdcObjectName(objectType), recordId, matchResult.ownerId, ROUTING_ACTION_FIELD);
            }
            const accountOwnerLog = await prisma.routingLog.create({
              data: {
                orgId, sfdcRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                assigneeId: matchResult.ownerId, assigneeName: "Matched Account Owner",
                status: "SUCCESS", routingDurationMs: startMs ? Date.now() - startMs : null,
                isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
              },
            });
            updateAggregates({
              orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
              teamId: null, assigneeId: matchResult.ownerId, objectType, status: "SUCCESS",
              durationMs: startMs ? Date.now() - startMs : null,
            }).catch(() => {});
            if (objectType === "LEAD") {
              createConversionTracking({
                orgId, routingLogId: accountOwnerLog.id, sfdcLeadId: recordId,
                ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                teamId: null, assigneeId: matchResult.ownerId, assigneeName: "Matched Account Owner",
              }).catch(() => {});
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
                await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
              }
              const accountCustomLog = await prisma.routingLog.create({
                data: {
                  orgId, sfdcRecordId: recordId, objectType, eventType,
                  ruleId: rule.id, ruleName: rule.name,
                  assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                  assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
                  teamId: assignee.teamId, teamName: assignee.teamName,
                  status: "SUCCESS", routingDurationMs: startMs ? Date.now() - startMs : null,
                  isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
                },
              });
              updateAggregates({
                orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
                teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
                durationMs: startMs ? Date.now() - startMs : null,
              }).catch(() => {});
              if (objectType === "LEAD") {
                createConversionTracking({
                  orgId, routingLogId: accountCustomLog.id, sfdcLeadId: recordId,
                  ruleId: rule.id, ruleName: rule.name, pathLabel: null,
                  teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                }).catch(() => {});
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
    const evalStart = Date.now();
    const evalResult = await evaluateRuleDetailed(fields, branch.conditions, orgId);
    if (trace) trace.timing.evaluationMs = (trace.timing.evaluationMs ?? 0) + (Date.now() - evalStart);

    const branchLabel = branch.label || `Path ${rule.branches.indexOf(branch) + 1}`;
    ruleTrace.branches!.push({
      branchId: branch.id,
      label: branchLabel,
      priority: branch.priority,
      matched: evalResult.matched,
      conditionGroups: evalResult.groups,
    });

    if (evalResult.matched) {
      ruleTrace.outcome = "MATCHED";
      const assignee = await resolveBranchAssignee(branch, orgId);
      if (!assignee) continue; // branch has no eligible assignee, try next

      const branchLabel = branch.label || `Path ${rule.branches.indexOf(branch) + 1}`;
      const log = await prisma.routingLog.create({
        data: {
          orgId, sfdcRecordId: recordId, objectType, eventType,
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
        }).catch(() => {});
        if (objectType === "LEAD") {
          createConversionTracking({
            orgId, routingLogId: log.id, sfdcLeadId: recordId,
            ruleId: rule.id, ruleName: rule.name, pathLabel: branchLabel,
            teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          }).catch(() => {});
        }
        return "dry_run";
      }

      try {
        const conn = await getOrgConnection(orgId);
        await setCooldown(orgId, recordId);
        await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
        await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
        updateAggregates({
          orgId, date: new Date(), ruleId: rule.id, pathLabel: branchLabel, branchId: branch.id,
          teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
          durationMs: startMs ? Date.now() - startMs : null,
        }).catch(() => {});
        if (objectType === "LEAD") {
          createConversionTracking({
            orgId, routingLogId: log.id, sfdcLeadId: recordId,
            ruleId: rule.id, ruleName: rule.name, pathLabel: branchLabel,
            teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          }).catch(() => {});
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
        evictOrgConnection(orgId);
        await enqueueRetry({
          logId: log.id, orgId, recordId,
          objectType: toSfdcObjectName(objectType),
          ownerId: assignee.sfdcOwnerId,
        });
        console.error(`[router] SFDC update failed for ${recordId}, enqueued for retry:`, err);
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
          orgId, sfdcRecordId: recordId, objectType, eventType,
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
        }).catch(() => {});
        if (objectType === "LEAD") {
          createConversionTracking({
            orgId, routingLogId: log.id, sfdcLeadId: recordId,
            ruleId: rule.id, ruleName: rule.name, pathLabel: "Default Owner",
            teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          }).catch(() => {});
        }
        return "dry_run";
      }

      try {
        const conn = await getOrgConnection(orgId);
        await setCooldown(orgId, recordId);
        await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
        await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
        updateAggregates({
          orgId, date: new Date(), ruleId: rule.id, pathLabel: "Default Owner", branchId: null,
          teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
          durationMs: startMs ? Date.now() - startMs : null,
        }).catch(() => {});
        if (objectType === "LEAD") {
          createConversionTracking({
            orgId, routingLogId: log.id, sfdcLeadId: recordId,
            ruleId: rule.id, ruleName: rule.name, pathLabel: "Default Owner",
            teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          }).catch(() => {});
        }
        return "routed";
      } catch (err) {
        evictOrgConnection(orgId);
        await enqueueRetry({
          logId: log.id, orgId, recordId,
          objectType: toSfdcObjectName(objectType),
          ownerId: assignee.sfdcOwnerId,
        });
        return "routed";
      }
    }
  }

  // New-style rule with no matching branch and no default owner → UNMATCHED
  await prisma.routingLog.create({
    data: {
      orgId, sfdcRecordId: recordId, objectType, eventType,
      ruleId: rule.id, ruleName: rule.name,
      status: "UNMATCHED", routingDurationMs: startMs ? Date.now() - startMs : null,
      isDryRun: rule.isDryRun, recordSnapshot: stripPii(fields) as any,
    },
  });
  updateAggregates({
    orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
    teamId: null, assigneeId: null, objectType, status: "UNMATCHED",
    durationMs: startMs ? Date.now() - startMs : null,
  }).catch(() => {});
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
        orgId, sfdcRecordId: recordId, objectType, eventType,
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
    }).catch(() => {});
    return "unmatched";
  }

  const log = await prisma.routingLog.create({
    data: {
      orgId, sfdcRecordId: recordId, objectType, eventType,
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
    }).catch(() => {});
    if (objectType === "LEAD") {
      createConversionTracking({
        orgId, routingLogId: log.id, sfdcLeadId: recordId,
        ruleId: rule.id, ruleName: rule.name, pathLabel: null,
        teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
      }).catch(() => {});
    }
    return "dry_run";
  }

  try {
    const conn = await getOrgConnection(orgId);
    await setCooldown(orgId, recordId);
    await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId, ROUTING_ACTION_FIELD);
    await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
    updateAggregates({
      orgId, date: new Date(), ruleId: rule.id, pathLabel: null, branchId: null,
      teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, objectType, status: "SUCCESS",
      durationMs: startMs ? Date.now() - startMs : null,
    }).catch(() => {});
    if (objectType === "LEAD") {
      createConversionTracking({
        orgId, routingLogId: log.id, sfdcLeadId: recordId,
        ruleId: rule.id, ruleName: rule.name, pathLabel: null,
        teamId: assignee.teamId ?? null, assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
      }).catch(() => {});
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
    evictOrgConnection(orgId);
    await enqueueRetry({
      logId: log.id, orgId, recordId,
      objectType: toSfdcObjectName(objectType),
      ownerId: assignee.sfdcOwnerId,
    });
    console.error(`[router] SFDC update failed for ${recordId}, enqueued for retry:`, err);
    return "routed";
  }
}
