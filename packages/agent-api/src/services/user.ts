import type { AgentContext } from "../types";

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  isLicensed: boolean;
  crmUserId: string;
  createdAt: Date;
}

export interface SyncUsersResult {
  synced: number;
}

export interface BulkLicenseResult {
  updated: number;
}

export class UserService {
  static async list(ctx: AgentContext): Promise<UserSummary[]> {
    const users = await ctx.prisma.user.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { name: "asc" },
    });

    return users.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      isLicensed: u.isLicensed,
      crmUserId: u.crmUserId,
      createdAt: u.createdAt,
    }));
  }

  static async sync(ctx: AgentContext): Promise<SyncUsersResult> {
    const count = await ctx.prisma.user.count({ where: { orgId: ctx.orgId } });
    return { synced: count };
  }

  static async bulkLicense(
    userIds: string[],
    licensed: boolean,
    ctx: AgentContext,
  ): Promise<BulkLicenseResult> {
    const result = await ctx.prisma.user.updateMany({
      where: { orgId: ctx.orgId, id: { in: userIds } },
      data: { isLicensed: licensed },
    });

    await ctx.prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorName: ctx.actorName,
        action: licensed ? "USERS_LICENSED" : "USERS_UNLICENSED",
        entityType: "User",
        entityId: "bulk",
        afterState: { userIds, licensed },
      },
    });

    return { updated: result.count };
  }
}
