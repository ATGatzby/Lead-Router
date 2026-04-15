import type { AgentContext } from "../types";
import { NotFoundError } from "../errors";

export interface CreateTeamInput {
  name: string;
  description?: string;
  distributionType: string;
}

export interface AddMembersInput {
  teamId: string;
  emails: string[];
}

export interface AddMembersResult {
  added: number;
  notFound: string[];
}

export interface SetWeightsInput {
  teamId: string;
  weights: Record<string, number>;
}

export interface TeamSummary {
  id: string;
  name: string;
  description: string | null;
  distributionType: string;
  memberCount: number;
  activeCount: number;
  totalAssigned: number;
  createdAt: Date;
}

export class TeamService {
  static async create(input: CreateTeamInput, ctx: AgentContext) {
    const team = await ctx.prisma.roundRobinTeam.create({
      data: {
        orgId: ctx.orgId,
        name: input.name,
        description: input.description ?? undefined,
        distributionType: input.distributionType,
      },
    });

    await ctx.prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorName: ctx.actorName,
        action: "TEAM_CREATED",
        entityType: "RoundRobinTeam",
        entityId: team.id,
        afterState: { name: input.name, description: input.description ?? null },
      },
    });

    return team;
  }

  static async list(ctx: AgentContext): Promise<TeamSummary[]> {
    const teams = await ctx.prisma.roundRobinTeam.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { createdAt: "asc" },
      include: {
        members: {
          select: { status: true, assignmentCount: true },
        },
      },
    });

    return teams.map((team: any) => ({
      id: team.id,
      name: team.name,
      description: team.description,
      distributionType: team.distributionType,
      memberCount: team.members.length,
      activeCount: team.members.filter((m: any) => m.status === "ACTIVE").length,
      totalAssigned: team.members.reduce((sum: number, m: any) => sum + m.assignmentCount, 0),
      createdAt: team.createdAt,
    }));
  }

  static async addMembers(input: AddMembersInput, ctx: AgentContext): Promise<AddMembersResult> {
    const team = await ctx.prisma.roundRobinTeam.findFirst({
      where: { id: input.teamId, orgId: ctx.orgId },
    });
    if (!team) throw new NotFoundError("Team", input.teamId);

    const users = await ctx.prisma.user.findMany({
      where: { orgId: ctx.orgId, email: { in: input.emails } },
      select: { id: true, email: true },
    });

    const foundEmails = new Set(users.map((u: any) => u.email));
    const notFound = input.emails.filter((e: string) => !foundEmails.has(e));

    if (users.length > 0) {
      await ctx.prisma.teamMember.createMany({
        data: users.map((u) => ({
          teamId: input.teamId,
          userId: u.id,
          status: "ACTIVE" as const,
        })),
        skipDuplicates: true,
      });
    }

    return { added: users.length, notFound };
  }

  static async setWeights(input: SetWeightsInput, ctx: AgentContext): Promise<number> {
    const team = await ctx.prisma.roundRobinTeam.findFirst({
      where: { id: input.teamId, orgId: ctx.orgId },
    });
    if (!team) throw new NotFoundError("Team", input.teamId);

    let updated = 0;
    for (const [userId, weight] of Object.entries(input.weights)) {
      const result = await ctx.prisma.teamMember.updateMany({
        where: { teamId: input.teamId, userId },
        data: { weight },
      });
      updated += result.count;
    }

    return updated;
  }

  static async update(
    teamId: string,
    data: { name?: string; description?: string; distributionType?: string },
    ctx: AgentContext,
  ) {
    const team = await ctx.prisma.roundRobinTeam.findFirst({
      where: { id: teamId, orgId: ctx.orgId },
    });
    if (!team) throw new NotFoundError("Team", teamId);

    return ctx.prisma.roundRobinTeam.update({
      where: { id: teamId },
      data,
    });
  }

  static async delete(teamId: string, ctx: AgentContext): Promise<void> {
    const team = await ctx.prisma.roundRobinTeam.findFirst({
      where: { id: teamId, orgId: ctx.orgId },
    });
    if (!team) throw new NotFoundError("Team", teamId);

    await ctx.prisma.teamMember.deleteMany({ where: { teamId } });
    await ctx.prisma.roundRobinTeam.delete({ where: { id: teamId } });

    await ctx.prisma.auditLog.create({
      data: {
        orgId: ctx.orgId,
        actorId: ctx.actorId,
        actorName: ctx.actorName,
        action: "TEAM_DELETED",
        entityType: "RoundRobinTeam",
        entityId: teamId,
        afterState: { name: team.name },
      },
    });
  }
}
