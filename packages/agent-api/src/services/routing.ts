import type { AgentContext } from "../types";

const DEFAULT_MODE: Record<string, string> = {
  LEAD: "CLASSIC",
  CONTACT: "CLASSIC",
  ACCOUNT: "CLASSIC",
};

export class RoutingService {
  static async getMode(ctx: AgentContext): Promise<Record<string, string>> {
    const org = await ctx.prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { routingMode: true },
    });

    return {
      ...DEFAULT_MODE,
      ...((org?.routingMode as Record<string, string>) ?? {}),
    };
  }

  static async setMode(
    objectType: string,
    mode: string,
    ctx: AgentContext,
  ): Promise<Record<string, string>> {
    const org = await ctx.prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { routingMode: true },
    });

    const currentMode = {
      ...DEFAULT_MODE,
      ...((org?.routingMode as Record<string, string>) ?? {}),
    };
    currentMode[objectType] = mode;

    await ctx.prisma.organization.update({
      where: { id: ctx.orgId },
      data: { routingMode: currentMode },
    });

    await ctx.prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorName: ctx.actorName,
        action: "ROUTING_MODE_CHANGED",
        entityType: "Organization",
        entityId: ctx.orgId,
        afterState: { objectType, mode },
      },
    });

    return currentMode;
  }
}
