import { prisma } from "@lead-routing/db";
import { updateOwner } from "@lead-routing/sfdc";
import { getActiveRules, type CachedRule } from "./cache.js";
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

export type RoutingResult = "routed" | "unmatched" | "dry_run";

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

async function resolveAssignee(
  rule: CachedRule
): Promise<AssigneeInfo | null> {
  if (rule.assignmentType === "USER" && rule.assigneeUserId) {
    const sfdcId = await getSfdcUserId(rule.assigneeUserId);
    const user = await prisma.user.findUnique({
      where: { id: rule.assigneeUserId },
      select: { name: true },
    });
    return {
      sfdcOwnerId: sfdcId,
      assigneeId: rule.assigneeUserId,
      assigneeName: user?.name ?? sfdcId,
      assignmentType: "USER",
    };
  }

  if (rule.assignmentType === "ROUND_ROBIN" && rule.assigneeTeamId) {
    const activeMembers = await prisma.teamMember.findMany({
      where: { teamId: rule.assigneeTeamId, status: "ACTIVE" },
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

    const next = await getNextMember(rule.orgId, rule.assigneeTeamId, members);
    if (!next) return null;

    // Increment the member's assignment count
    await prisma.teamMember.update({
      where: { id: next.id },
      data: { assignmentCount: { increment: 1 } },
    });

    // Update user's lastRoutedAt
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

  if (rule.assignmentType === "QUEUE" && rule.assigneeQueueId) {
    const sfdcId = await getSfdcQueueId(rule.assigneeQueueId);
    const queue = await prisma.sfdcQueue.findUnique({
      where: { id: rule.assigneeQueueId },
      select: { name: true },
    });
    return {
      sfdcOwnerId: sfdcId,
      assigneeId: rule.assigneeQueueId,
      assigneeName: queue?.name ?? sfdcId,
      assignmentType: "QUEUE",
    };
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

  // Find first matching rule
  let matchedRule: CachedRule | null = null;
  for (const rule of eligibleRules) {
    if (evaluateRule(fields, rule.conditions)) {
      matchedRule = rule;
      break;
    }
  }

  // No match — log UNMATCHED and return
  if (!matchedRule) {
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

  // Resolve assignee
  const assignee = await resolveAssignee(matchedRule);
  if (!assignee) {
    // Assignee is gone (team empty, user removed, etc.) — log FAILED
    await prisma.routingLog.create({
      data: {
        orgId,
        sfdcRecordId: recordId,
        objectType,
        eventType,
        ruleId: matchedRule.id,
        ruleName: matchedRule.name,
        status: "FAILED",
        errorMessage: "No eligible assignee found",
        isDryRun: matchedRule.isDryRun,
        recordSnapshot: fields,
      },
    });
    return "unmatched";
  }

  // Create initial log entry (will be updated after SFDC call)
  const log = await prisma.routingLog.create({
    data: {
      orgId,
      sfdcRecordId: recordId,
      objectType,
      eventType,
      ruleId: matchedRule.id,
      ruleName: matchedRule.name,
      assigneeId: assignee.sfdcOwnerId,
      assigneeName: assignee.assigneeName,
      assignmentType: assignee.assignmentType as "USER" | "ROUND_ROBIN" | "QUEUE",
      isDryRun: matchedRule.isDryRun,
      status: "RETRY",
      recordSnapshot: fields,
    },
  });

  // Dry-run: skip SFDC write
  if (matchedRule.isDryRun) {
    await prisma.routingLog.update({
      where: { id: log.id },
      data: { status: "SUCCESS" },
    });
    return "dry_run";
  }

  // Write to SFDC
  try {
    const conn = await getOrgConnection(orgId);
    await updateOwner(conn, toSfdcObjectName(objectType), recordId, assignee.sfdcOwnerId);

    await prisma.routingLog.update({
      where: { id: log.id },
      data: { status: "SUCCESS" },
    });

    // Fire notification webhook (non-blocking — errors are swallowed in webhook.ts)
    if (assignee && matchedRule) {
      fireWebhook(orgId, {
        event: `${objectType}_ROUTED`,
        recordId,
        objectType,
        assigneeName: assignee.assigneeName,
        assigneeId: assignee.assigneeId,
        ruleName: matchedRule.name,
        ruleId: matchedRule.id,
        timestamp: new Date().toISOString(),
      });
    }

    return "routed";
  } catch (err) {
    // Enqueue for retry
    await enqueueRetry({
      logId: log.id,
      orgId,
      recordId,
      objectType: toSfdcObjectName(objectType),
      ownerId: assignee.sfdcOwnerId,
    });

    console.error(`[router] SFDC update failed for ${recordId}, enqueued for retry:`, err);
    return "routed"; // optimistic — retry is in flight
  }
}
