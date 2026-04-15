import type { AgentContext } from "../types";
import { CrmUnsupportedError } from "../errors";

export interface QueueSummary {
  id: string;
  name: string;
  sfdcQueueId: string;
}

export interface QueueSyncResult {
  synced: number;
  warning?: string;
}

export class QueueService {
  static async list(ctx: AgentContext): Promise<{ queues: QueueSummary[]; warning?: string }> {
    if (ctx.crmType === "HUBSPOT") {
      return {
        queues: [],
        warning: "Queues are not available for HubSpot orgs — HubSpot does not have a queue concept.",
      };
    }

    const queues = await ctx.prisma.sfdcQueue.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sfdcQueueId: true,
      },
    });

    return { queues };
  }

  static async sync(ctx: AgentContext): Promise<QueueSyncResult> {
    if (ctx.crmType === "HUBSPOT") {
      return {
        synced: 0,
        warning: "Queue sync skipped — HubSpot does not have a queue concept.",
      };
    }

    // Actual SFDC queue sync involves calling the CRM API.
    // The caller handles the CRM-specific logic.
    const count = await ctx.prisma.sfdcQueue.count({ where: { orgId: ctx.orgId } });
    return { synced: count };
  }
}
