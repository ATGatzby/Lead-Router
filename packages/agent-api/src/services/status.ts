import type { AgentContext } from "../types";
import { RoutingService } from "./routing";

export interface SystemStatus {
  crmConnected: boolean;
  crmType: string;
  routingModes: Record<string, string>;
  activeRules: number;
  totalRules: number;
  teams: number;
  usersLicensed: number;
}

export class StatusService {
  static async health(ctx: AgentContext): Promise<SystemStatus> {
    const org = await ctx.prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: {
        sfdcOrgId: true,
        hubspotPortalId: true,
        oauthAccessToken: true,
      },
    });

    const crmConnected = ctx.crmType === "SALESFORCE"
      ? !!(org?.sfdcOrgId && org?.oauthAccessToken)
      : !!(org?.hubspotPortalId && org?.oauthAccessToken);

    const [modes, activeRules, totalRules, teamCount, licensedUsers] = await Promise.all([
      RoutingService.getMode(ctx),
      ctx.prisma.routingRule.count({ where: { orgId: ctx.orgId, status: "ACTIVE" as any } }),
      ctx.prisma.routingRule.count({ where: { orgId: ctx.orgId } }),
      ctx.prisma.roundRobinTeam.count({ where: { orgId: ctx.orgId } }),
      ctx.prisma.user.count({ where: { orgId: ctx.orgId, isLicensed: true } }),
    ]);

    return {
      crmConnected,
      crmType: ctx.crmType,
      routingModes: modes,
      activeRules,
      totalRules,
      teams: teamCount,
      usersLicensed: licensedUsers,
    };
  }
}
