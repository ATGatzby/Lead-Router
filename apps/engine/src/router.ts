import { prisma } from "@lead-routing/db";
import { updateOwner, mergeLead } from "@lead-routing/sfdc";
import { getActiveRules, type CachedRule, type CachedBranch, type CachedMatchConfig } from "./cache.js";
import { evaluateRule } from "./evaluator.js";
import { getNextMember } from "./round-robin.js";
import { getOrgConnection, getSfdcUserId, getSfdcQueueId } from "./sfdc.js";
import { enqueueRetry } from "./queue.js";
import { fireWebhook } from "./webhook.js";

// ─── Payload type ─────────────────────────────────────────────────────────

export interface RoutingPayload {
  orgId: string;
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  eventType: "INSERT" | "UPDATE" | "BOTH";
  recordId: string;
  timestamp: string;
  fields: Record<string, unknown>;
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
    const activeMembers = await prisma.teamMember.findMany({
      where: { teamId: assigneeTeamId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, sfdcUserId: true, name: true, email: true } } },
    });

    if (activeMembers.length === 0) return null;

    const members = activeMembers.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      assignmentCount: m.assignmentCount,
    }));

    const next = await getNextMember(orgId, assigneeTeamId, members);
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
    branch.assignmentType,
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
  conn: any
): Promise<MatchResult | null> {
  const email = String(fields["Email"] ?? fields["email"] ?? "").toLowerCase().trim();
  const phone = String(fields["Phone"] ?? fields["phone"] ?? fields["MobilePhone"] ?? "").trim();
  const company = String(fields["Company"] ?? fields["company"] ?? "").trim();

  const emailDomain = email.includes("@") ? email.split("@")[1] : null;

  // Helper: run SOQL and get first matching record's OwnerId
  async function soqlFirst(soql: string): Promise<{ Id: string; OwnerId: string } | null> {
    try {
      const res = await conn.query(soql);
      if (res.records && res.records.length > 0) {
        return res.records[0] as { Id: string; OwnerId: string };
      }
    } catch (err) {
      console.error("[matcher] SOQL error:", err);
    }
    return null;
  }

  // 1. Check Leads
  if (matchConfig.checkLeads && email) {
    const lead = await soqlFirst(
      `SELECT Id, OwnerId FROM Lead WHERE Email = '${email.replace(/'/g, "\\'")}' AND IsConverted = false LIMIT 1`
    );
    if (lead) return { type: "LEAD", ownerId: lead.OwnerId, recordId: lead.Id };
  }

  // 2. Check Contacts
  if (matchConfig.checkContacts && email) {
    const contact = await soqlFirst(
      `SELECT Id, OwnerId FROM Contact WHERE Email = '${email.replace(/'/g, "\\'")}' LIMIT 1`
    );
    if (contact) return { type: "CONTACT", ownerId: contact.OwnerId, recordId: contact.Id };
  }

  // 3. Check Accounts by domain
  if (matchConfig.checkAccounts && matchConfig.matchDomain && emailDomain) {
    const account = await soqlFirst(
      `SELECT Id, OwnerId FROM Account WHERE Website LIKE '%${emailDomain.replace(/'/g, "\\'")}%' LIMIT 1`
    );
    if (account) return { type: "ACCOUNT", ownerId: account.OwnerId, recordId: account.Id };
  }

  // Phone-based checks
  if (matchConfig.matchPhone && phone) {
    if (matchConfig.checkLeads) {
      const lead = await soqlFirst(
        `SELECT Id, OwnerId FROM Lead WHERE Phone = '${phone.replace(/'/g, "\\'")}' AND IsConverted = false LIMIT 1`
      );
      if (lead) return { type: "LEAD", ownerId: lead.OwnerId, recordId: lead.Id };
    }
    if (matchConfig.checkContacts) {
      const contact = await soqlFirst(
        `SELECT Id, OwnerId FROM Contact WHERE Phone = '${phone.replace(/'/g, "\\'")}' LIMIT 1`
      );
      if (contact) return { type: "CONTACT", ownerId: contact.OwnerId, recordId: contact.Id };
    }
  }

  return null;
}

// ─── Main router ─────────────────────────────────────────────────────────

export async function routeRecord(payload: RoutingPayload): Promise<RoutingResult> {
  const { orgId, objectType, eventType, recordId, fields } = payload;
  const rules = getActiveRules(orgId, objectType);

  // Filter by trigger event
  const eligibleRules = rules.filter(
    (r) => r.triggerEvent === "BOTH" || r.triggerEvent === eventType
  );

  for (const rule of eligibleRules) {
    // Determine if this is a new-style Route Builder rule (has branches) or legacy rule
    const isNewStyle = rule.branches.length > 0 || rule.matchConfig !== null || rule.defaultOwnerType !== null;

    if (isNewStyle) {
      const result = await routeNewStyle(rule, payload);
      if (result !== null) return result;
      // null = this rule produced no outcome, try next rule (shouldn't happen for new-style but safety)
    } else {
      // Legacy routing: evaluate conditions + single assignee
      if (evaluateRule(fields, rule.conditions)) {
        const result = await routeLegacy(rule, payload);
        if (result !== null) return result;
      }
    }
  }

  // No rule matched at all
  await prisma.routingLog.create({
    data: {
      orgId,
      sfdcRecordId: recordId,
      objectType,
      eventType,
      status: "UNMATCHED",
      recordSnapshot: fields,
    },
  });
  return "unmatched";
}

// ─── New-style routing (Route Builder) ───────────────────────────────────

async function routeNewStyle(
  rule: CachedRule,
  payload: RoutingPayload
): Promise<RoutingResult | null> {
  const { orgId, objectType, eventType, recordId, fields } = payload;

  // Step 1: Match step (optional)
  if (rule.matchConfig) {
    let conn: any;
    try {
      conn = await getOrgConnection(orgId);
    } catch {
      console.error(`[router] Could not get SFDC connection for match step, skipping match`);
    }

    if (conn) {
      const matchResult = await runMatcher(fields, rule.matchConfig, conn);

      if (matchResult) {
        const mc = rule.matchConfig;

        // ── Lead matched ──
        if (matchResult.type === "LEAD") {
          if (mc.onLeadMatch === "SFDC_MERGE") {
            if (!rule.isDryRun) {
              try {
                await mergeLead(conn, recordId, matchResult.recordId);
              } catch (err) {
                console.error(`[router] Lead merge failed:`, err);
                await prisma.routingLog.create({
                  data: {
                    orgId, sfdcRecordId: recordId, objectType, eventType,
                    ruleId: rule.id, ruleName: rule.name,
                    status: "FAILED", errorMessage: String(err),
                    isDryRun: rule.isDryRun, recordSnapshot: fields,
                  },
                });
                return "unmatched";
              }
            }
            await prisma.routingLog.create({
              data: {
                orgId, sfdcRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                status: "MERGED", isDryRun: rule.isDryRun, recordSnapshot: fields,
              },
            });
            return "merged";
          }

          if (mc.onLeadMatch === "ASSIGN_TO_OWNER") {
            if (!rule.isDryRun) {
              await updateOwner(conn, toSfdcObjectName(objectType), recordId, matchResult.ownerId);
            }
            await prisma.routingLog.create({
              data: {
                orgId, sfdcRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                assigneeId: matchResult.ownerId, assigneeName: "Matched Lead Owner",
                status: "SUCCESS", isDryRun: rule.isDryRun, recordSnapshot: fields,
              },
            });
            return "routed";
          }

          if (mc.onLeadMatch === "ASSIGN_CUSTOM" && mc.leadAssignmentType) {
            const assignee = await resolveAssigneeFromFields(
              mc.leadAssignmentType, mc.leadAssigneeUserId, mc.leadAssigneeTeamId, mc.leadAssigneeQueueId, orgId
            );
            if (assignee) {
              if (!rule.isDryRun) {
                await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId);
              }
              await prisma.routingLog.create({
                data: {
                  orgId, sfdcRecordId: recordId, objectType, eventType,
                  ruleId: rule.id, ruleName: rule.name,
                  assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                  assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
                  status: "SUCCESS", isDryRun: rule.isDryRun, recordSnapshot: fields,
                },
              });
              return "routed";
            }
          }
        }

        // ── Contact matched ──
        if (matchResult.type === "CONTACT") {
          if (mc.onContactMatch === "ASSIGN_TO_OWNER") {
            if (!rule.isDryRun) {
              await updateOwner(conn, toSfdcObjectName(objectType), recordId, matchResult.ownerId);
            }
            await prisma.routingLog.create({
              data: {
                orgId, sfdcRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                assigneeId: matchResult.ownerId, assigneeName: "Matched Contact Owner",
                status: "SUCCESS", isDryRun: rule.isDryRun, recordSnapshot: fields,
              },
            });
            return "routed";
          }

          if (mc.onContactMatch === "ASSIGN_CUSTOM" && mc.contactAssignmentType) {
            const assignee = await resolveAssigneeFromFields(
              mc.contactAssignmentType, mc.contactAssigneeUserId, mc.contactAssigneeTeamId, mc.contactAssigneeQueueId, orgId
            );
            if (assignee) {
              if (!rule.isDryRun) {
                await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId);
              }
              await prisma.routingLog.create({
                data: {
                  orgId, sfdcRecordId: recordId, objectType, eventType,
                  ruleId: rule.id, ruleName: rule.name,
                  assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                  assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
                  status: "SUCCESS", isDryRun: rule.isDryRun, recordSnapshot: fields,
                },
              });
              return "routed";
            }
          }
          // SKIP → fall through to branch evaluation
        }

        // ── Account matched ──
        if (matchResult.type === "ACCOUNT") {
          if (mc.onAccountMatch === "ASSIGN_TO_OWNER") {
            if (!rule.isDryRun) {
              await updateOwner(conn, toSfdcObjectName(objectType), recordId, matchResult.ownerId);
            }
            await prisma.routingLog.create({
              data: {
                orgId, sfdcRecordId: recordId, objectType, eventType,
                ruleId: rule.id, ruleName: rule.name,
                assigneeId: matchResult.ownerId, assigneeName: "Matched Account Owner",
                status: "SUCCESS", isDryRun: rule.isDryRun, recordSnapshot: fields,
              },
            });
            return "routed";
          }

          if (mc.onAccountMatch === "ASSIGN_CUSTOM" && mc.accountAssignmentType) {
            const assignee = await resolveAssigneeFromFields(
              mc.accountAssignmentType, mc.accountAssigneeUserId, mc.accountAssigneeTeamId, mc.accountAssigneeQueueId, orgId
            );
            if (assignee) {
              if (!rule.isDryRun) {
                await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId);
              }
              await prisma.routingLog.create({
                data: {
                  orgId, sfdcRecordId: recordId, objectType, eventType,
                  ruleId: rule.id, ruleName: rule.name,
                  assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
                  assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
                  status: "SUCCESS", isDryRun: rule.isDryRun, recordSnapshot: fields,
                },
              });
              return "routed";
            }
          }
          // SKIP → fall through
        }
      }
    }
  }

  // Step 2: Branch (path) evaluation
  for (const branch of rule.branches) {
    if (evaluateRule(fields, branch.conditions)) {
      const assignee = await resolveBranchAssignee(branch, orgId);
      if (!assignee) continue; // branch has no eligible assignee, try next

      const log = await prisma.routingLog.create({
        data: {
          orgId, sfdcRecordId: recordId, objectType, eventType,
          ruleId: rule.id, ruleName: rule.name,
          assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
          isDryRun: rule.isDryRun, status: "RETRY", recordSnapshot: fields,
        },
      });

      if (rule.isDryRun) {
        await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
        return "dry_run";
      }

      try {
        const conn = await getOrgConnection(orgId);
        await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId);
        await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
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

    if (assignee) {
      const log = await prisma.routingLog.create({
        data: {
          orgId, sfdcRecordId: recordId, objectType, eventType,
          ruleId: rule.id, ruleName: rule.name,
          assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
          assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
          isDryRun: rule.isDryRun, status: "RETRY", recordSnapshot: fields,
        },
      });

      if (rule.isDryRun) {
        await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
        return "dry_run";
      }

      try {
        const conn = await getOrgConnection(orgId);
        await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId);
        await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
        return "routed";
      } catch (err) {
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
      status: "UNMATCHED", isDryRun: rule.isDryRun, recordSnapshot: fields,
    },
  });
  return "unmatched";
}

// ─── Legacy routing ───────────────────────────────────────────────────────

async function routeLegacy(
  rule: CachedRule,
  payload: RoutingPayload
): Promise<RoutingResult | null> {
  const { orgId, objectType, eventType, recordId, fields } = payload;

  const assignee = await resolveAssignee(rule);
  if (!assignee) {
    await prisma.routingLog.create({
      data: {
        orgId, sfdcRecordId: recordId, objectType, eventType,
        ruleId: rule.id, ruleName: rule.name,
        status: "FAILED", errorMessage: "No eligible assignee found",
        isDryRun: rule.isDryRun, recordSnapshot: fields,
      },
    });
    return "unmatched";
  }

  const log = await prisma.routingLog.create({
    data: {
      orgId, sfdcRecordId: recordId, objectType, eventType,
      ruleId: rule.id, ruleName: rule.name,
      assigneeId: assignee.sfdcOwnerId, assigneeName: assignee.assigneeName,
      assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
      isDryRun: rule.isDryRun, status: "RETRY", recordSnapshot: fields,
    },
  });

  if (rule.isDryRun) {
    await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
    return "dry_run";
  }

  try {
    const conn = await getOrgConnection(orgId);
    await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId);
    await prisma.routingLog.update({ where: { id: log.id }, data: { status: "SUCCESS" } });
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
    await enqueueRetry({
      logId: log.id, orgId, recordId,
      objectType: toSfdcObjectName(objectType),
      ownerId: assignee.sfdcOwnerId,
    });
    console.error(`[router] SFDC update failed for ${recordId}, enqueued for retry:`, err);
    return "routed";
  }
}
