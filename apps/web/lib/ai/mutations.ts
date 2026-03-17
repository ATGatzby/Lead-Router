import { prisma } from "@lead-routing/db";
import { invalidateRulesCache } from "@/lib/invalidate-rules-cache";
import { syncRoutingFlags } from "@/lib/sync-routing-flags";
import { getTierLimits } from "@/lib/license";

// ─── Shared constants ────────────────────────────────────────────────────────

const AI_ACTOR = { actorId: "ai-agent", actorName: "AI Assistant" } as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function logAiAction(opts: {
  orgId: string;
  context: string;
  toolName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  input: Record<string, unknown>;
  output: unknown;
  status: "preview" | "confirmed";
  startTime: number;
}) {
  await prisma.aiAgentLog.create({
    data: {
      orgId: opts.orgId,
      context: opts.context,
      toolName: opts.toolName,
      action: opts.action,
      entityType: opts.entityType,
      entityId: opts.entityId,
      entityName: opts.entityName,
      input: opts.input as any,
      output: (opts.output ?? null) as any,
      status: opts.status,
      ...AI_ACTOR,
      durationMs: Date.now() - opts.startTime,
    },
  });
}

// ─── License mutations ───────────────────────────────────────────────────────

export async function licenseUsers(orgId: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const confirm = (args.confirm as boolean) ?? false;
  const userIds = args.userIds as string[];

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { error: "userIds must be a non-empty array" };
  }

  // Fetch users + validate
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, orgId },
    select: { id: true, name: true, email: true, isLicensed: true, isActive: true },
  });

  if (users.length !== userIds.length) {
    const found = new Set(users.map((u) => u.id));
    const missing = userIds.filter((id) => !found.has(id));
    return { error: `Users not found: ${missing.join(", ")}` };
  }

  const toActivate = users.filter((u) => !u.isLicensed && u.isActive);
  const alreadyLicensed = users.filter((u) => u.isLicensed);
  const inactive = users.filter((u) => !u.isActive);

  if (toActivate.length === 0) {
    return {
      affected: 0,
      message: "No users to license",
      alreadyLicensed: alreadyLicensed.map((u) => u.name).join(", "),
      inactive: inactive.map((u) => u.name).join(", "),
    };
  }

  // Seat cap check
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { seatsPurchased: true },
  });
  const seatsUsed = await prisma.user.count({
    where: { orgId, isLicensed: true, isActive: true },
  });
  const available = org.seatsPurchased - seatsUsed;

  // Tier limit check
  const limits = getTierLimits();
  if (limits.maxSeats !== Infinity) {
    const licensedCount = await prisma.user.count({ where: { orgId, isLicensed: true } });
    if (licensedCount + toActivate.length > limits.maxSeats) {
      return { error: `Licensing more than ${limits.maxSeats} users requires a Pro license upgrade.` };
    }
  }

  if (toActivate.length > available) {
    return {
      error: "seat_cap_exceeded",
      seatsPurchased: org.seatsPurchased,
      seatsUsed,
      requested: toActivate.length,
      available,
    };
  }

  // ── Preview ──
  if (!confirm) {
    const preview = {
      action: "LICENSE",
      willLicense: toActivate.map((u) => ({ id: u.id, name: u.name, email: u.email })),
      count: toActivate.length,
      skippedAlreadyLicensed: alreadyLicensed.map((u) => u.name),
      skippedInactive: inactive.map((u) => u.name),
      seatsAfter: { used: seatsUsed + toActivate.length, purchased: org.seatsPurchased },
    };

    await logAiAction({
      orgId,
      context: "license-users",
      toolName: "license_users",
      action: "LICENSE",
      entityType: "User",
      entityId: null,
      entityName: `${toActivate.length} users: ${toActivate.map((u) => u.name).join(", ")}`,
      input: args,
      output: preview,
      status: "preview",
      startTime,
    });

    return preview;
  }

  // ── Execute ──
  const idsToActivate = toActivate.map((u) => u.id);

  await prisma.$transaction([
    prisma.user.updateMany({
      where: { id: { in: idsToActivate } },
      data: { isLicensed: true },
    }),
    prisma.organization.update({
      where: { id: orgId },
      data: { seatsUsed: { increment: idsToActivate.length } },
    }),
    prisma.auditLog.create({
      data: {
        orgId,
        ...AI_ACTOR,
        action: "BULK_LICENSED",
        entityType: "User",
        entityId: idsToActivate.join(","),
        afterState: { userIds: idsToActivate, isLicensed: true },
      },
    }),
  ]);

  const result = {
    action: "LICENSE",
    affected: idsToActivate.length,
    licensedUsers: toActivate.map((u) => ({ id: u.id, name: u.name })),
  };

  await logAiAction({
    orgId,
    context: "license-users",
    toolName: "license_users",
    action: "LICENSE",
    entityType: "User",
    entityId: idsToActivate.join(","),
    entityName: `${toActivate.length} users: ${toActivate.map((u) => u.name).join(", ")}`,
    input: args,
    output: result,
    status: "confirmed",
    startTime,
  });

  return result;
}

export async function delicenseUsers(orgId: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const confirm = (args.confirm as boolean) ?? false;
  const userIds = args.userIds as string[];

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return { error: "userIds must be a non-empty array" };
  }

  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, orgId },
    select: { id: true, name: true, email: true, isLicensed: true },
  });

  if (users.length !== userIds.length) {
    const found = new Set(users.map((u) => u.id));
    const missing = userIds.filter((id) => !found.has(id));
    return { error: `Users not found: ${missing.join(", ")}` };
  }

  const toDeactivate = users.filter((u) => u.isLicensed);
  const alreadyUnlicensed = users.filter((u) => !u.isLicensed);

  if (toDeactivate.length === 0) {
    return { affected: 0, message: "No users to de-license — all already unlicensed" };
  }

  // Check for active team memberships that will be paused
  const memberships = await prisma.teamMember.findMany({
    where: { userId: { in: toDeactivate.map((u) => u.id) }, status: "ACTIVE" },
    select: { userId: true, team: { select: { name: true } } },
  });

  // ── Preview ──
  if (!confirm) {
    const preview = {
      action: "DE_LICENSE",
      willDelicense: toDeactivate.map((u) => ({ id: u.id, name: u.name, email: u.email })),
      count: toDeactivate.length,
      skippedAlreadyUnlicensed: alreadyUnlicensed.map((u) => u.name),
      teamMembershipsToBePaused: memberships.map((m) => ({
        userId: m.userId,
        teamName: m.team.name,
      })),
    };

    await logAiAction({
      orgId,
      context: "license-users",
      toolName: "delicense_users",
      action: "DE_LICENSE",
      entityType: "User",
      entityId: null,
      entityName: `${toDeactivate.length} users: ${toDeactivate.map((u) => u.name).join(", ")}`,
      input: args,
      output: preview,
      status: "preview",
      startTime,
    });

    return preview;
  }

  // ── Execute ──
  const idsToDeactivate = toDeactivate.map((u) => u.id);

  // Pause active round robin memberships
  await prisma.teamMember.updateMany({
    where: { userId: { in: idsToDeactivate }, status: "ACTIVE" },
    data: { status: "PAUSED" },
  });

  await prisma.$transaction([
    prisma.user.updateMany({
      where: { id: { in: idsToDeactivate } },
      data: { isLicensed: false },
    }),
    prisma.organization.update({
      where: { id: orgId },
      data: { seatsUsed: { decrement: idsToDeactivate.length } },
    }),
    prisma.auditLog.create({
      data: {
        orgId,
        ...AI_ACTOR,
        action: "BULK_DE_LICENSED",
        entityType: "User",
        entityId: idsToDeactivate.join(","),
        afterState: { userIds: idsToDeactivate, isLicensed: false },
      },
    }),
  ]);

  const result = {
    action: "DE_LICENSE",
    affected: idsToDeactivate.length,
    delicensedUsers: toDeactivate.map((u) => ({ id: u.id, name: u.name })),
    membershipsPaused: memberships.length,
  };

  await logAiAction({
    orgId,
    context: "license-users",
    toolName: "delicense_users",
    action: "DE_LICENSE",
    entityType: "User",
    entityId: idsToDeactivate.join(","),
    entityName: `${toDeactivate.length} users: ${toDeactivate.map((u) => u.name).join(", ")}`,
    input: args,
    output: result,
    status: "confirmed",
    startTime,
  });

  return result;
}

// ─── Team mutations ──────────────────────────────────────────────────────────

export async function createTeam(orgId: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const confirm = (args.confirm as boolean) ?? false;
  const name = ((args.name as string) ?? "").trim();
  const description = ((args.description as string) ?? "").trim() || null;
  const distributionType = (args.distributionType as string) ?? "round-robin";

  if (!name) {
    return { error: "name is required" };
  }

  if (distributionType !== "round-robin" && distributionType !== "weighted") {
    return { error: "distributionType must be 'round-robin' or 'weighted'" };
  }

  // Tier check for weighted distribution
  const limits = getTierLimits();
  if (distributionType === "weighted" && !limits.weightedDistribution) {
    return { error: "Weighted distribution requires a Pro license upgrade." };
  }

  // Check for duplicate name
  const existing = await prisma.roundRobinTeam.findFirst({
    where: { orgId, name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
  });

  if (existing) {
    return { error: `A team named "${existing.name}" already exists (id: ${existing.id})` };
  }

  // ── Preview ──
  if (!confirm) {
    const preview = {
      action: "CREATE_TEAM",
      name,
      description,
      distributionType,
    };

    await logAiAction({
      orgId,
      context: "teams",
      toolName: "create_team",
      action: "CREATE",
      entityType: "RoundRobinTeam",
      entityId: null,
      entityName: name,
      input: args,
      output: preview,
      status: "preview",
      startTime,
    });

    return preview;
  }

  // ── Execute ──
  const team = await prisma.roundRobinTeam.create({
    data: { orgId, name, description: description ?? undefined, distributionType },
  });

  await prisma.auditLog.create({
    data: {
      orgId,
      ...AI_ACTOR,
      action: "TEAM_CREATED",
      entityType: "RoundRobinTeam",
      entityId: team.id,
      afterState: { name, description, distributionType },
    },
  });

  const result = { action: "CREATE_TEAM", team: { id: team.id, name: team.name, distributionType: team.distributionType } };

  await logAiAction({
    orgId,
    context: "teams",
    toolName: "create_team",
    action: "CREATE",
    entityType: "RoundRobinTeam",
    entityId: team.id,
    entityName: name,
    input: args,
    output: result,
    status: "confirmed",
    startTime,
  });

  return result;
}

export async function updateTeam(orgId: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const confirm = (args.confirm as boolean) ?? false;
  const teamId = args.teamId as string;

  if (!teamId) {
    return { error: "teamId is required" };
  }

  const existing = await prisma.roundRobinTeam.findFirst({
    where: { id: teamId, orgId },
    select: { id: true, name: true, description: true, distributionType: true },
  });

  if (!existing) {
    return { error: "Team not found" };
  }

  const updateData: Record<string, string | null> = {};
  const changes: string[] = [];

  if (args.name !== undefined) {
    const name = ((args.name as string) ?? "").trim();
    if (!name) return { error: "name cannot be empty" };
    updateData.name = name;
    changes.push(`name: "${existing.name}" -> "${name}"`);
  }

  if (args.description !== undefined) {
    updateData.description = ((args.description as string) ?? "").trim() || null;
    changes.push(`description updated`);
  }

  if (args.distributionType !== undefined) {
    const dt = args.distributionType as string;
    if (dt !== "round-robin" && dt !== "weighted") {
      return { error: "distributionType must be 'round-robin' or 'weighted'" };
    }
    const limits = getTierLimits();
    if (dt === "weighted" && !limits.weightedDistribution) {
      return { error: "Weighted distribution requires a Pro license upgrade." };
    }
    updateData.distributionType = dt;
    changes.push(`distributionType: "${existing.distributionType}" -> "${dt}"`);
  }

  if (Object.keys(updateData).length === 0) {
    return { error: "No fields to update. Provide at least one of: name, description, distributionType" };
  }

  // ── Preview ──
  if (!confirm) {
    const preview = {
      action: "UPDATE_TEAM",
      teamId: existing.id,
      teamName: existing.name,
      changes,
      before: { name: existing.name, description: existing.description, distributionType: existing.distributionType },
      after: updateData,
    };

    await logAiAction({
      orgId,
      context: "teams",
      toolName: "update_team",
      action: "UPDATE",
      entityType: "RoundRobinTeam",
      entityId: teamId,
      entityName: existing.name,
      input: args,
      output: preview,
      status: "preview",
      startTime,
    });

    return preview;
  }

  // ── Execute ──
  const updated = await prisma.roundRobinTeam.update({
    where: { id: teamId, orgId },
    data: updateData,
  });

  await prisma.auditLog.create({
    data: {
      orgId,
      ...AI_ACTOR,
      action: "TEAM_UPDATED",
      entityType: "RoundRobinTeam",
      entityId: teamId,
      beforeState: { name: existing.name, description: existing.description, distributionType: existing.distributionType },
      afterState: updateData,
    },
  });

  const result = { action: "UPDATE_TEAM", team: { id: updated.id, name: updated.name, distributionType: updated.distributionType } };

  await logAiAction({
    orgId,
    context: "teams",
    toolName: "update_team",
    action: "UPDATE",
    entityType: "RoundRobinTeam",
    entityId: teamId,
    entityName: updated.name,
    input: args,
    output: result,
    status: "confirmed",
    startTime,
  });

  return result;
}

export async function deleteTeam(orgId: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const confirm = (args.confirm as boolean) ?? false;
  const teamId = args.teamId as string;

  if (!teamId) {
    return { error: "teamId is required" };
  }

  const team = await prisma.roundRobinTeam.findFirst({
    where: { id: teamId, orgId },
    select: {
      id: true,
      name: true,
      members: { select: { id: true, user: { select: { name: true } } } },
    },
  });

  if (!team) {
    return { error: "Team not found" };
  }

  // Check for active routing rules referencing this team
  const activeRules = await prisma.routingRule.findMany({
    where: { assigneeTeamId: teamId, status: "ACTIVE" },
    select: { id: true, name: true },
  });

  if (activeRules.length > 0) {
    return {
      error: "Cannot delete team — referenced by active routing rules",
      blockingRules: activeRules.map((r) => ({ id: r.id, name: r.name })),
    };
  }

  // Also check branches that reference this team
  const activeBranchRules = await prisma.routingBranch.findMany({
    where: { assigneeTeamId: teamId, rule: { status: "ACTIVE" } },
    select: { rule: { select: { id: true, name: true } } },
  });

  if (activeBranchRules.length > 0) {
    const uniqueRules = [...new Map(activeBranchRules.map((b) => [b.rule.id, b.rule])).values()];
    return {
      error: "Cannot delete team — referenced by active routing rule branches",
      blockingRules: uniqueRules.map((r) => ({ id: r.id, name: r.name })),
    };
  }

  // ── Preview ──
  if (!confirm) {
    const preview = {
      action: "DELETE_TEAM",
      teamId: team.id,
      teamName: team.name,
      memberCount: team.members.length,
      members: team.members.map((m) => m.user.name),
      warning: team.members.length > 0
        ? `This will remove ${team.members.length} member(s) from the team.`
        : null,
    };

    await logAiAction({
      orgId,
      context: "teams",
      toolName: "delete_team",
      action: "DELETE",
      entityType: "RoundRobinTeam",
      entityId: teamId,
      entityName: team.name,
      input: args,
      output: preview,
      status: "preview",
      startTime,
    });

    return preview;
  }

  // ── Execute ──
  await prisma.roundRobinTeam.delete({ where: { id: teamId } });

  await prisma.auditLog.create({
    data: {
      orgId,
      ...AI_ACTOR,
      action: "TEAM_DELETED",
      entityType: "RoundRobinTeam",
      entityId: teamId,
      beforeState: { name: team.name, memberCount: team.members.length },
    },
  });

  const result = { action: "DELETE_TEAM", deletedTeam: team.name, membersRemoved: team.members.length };

  await logAiAction({
    orgId,
    context: "teams",
    toolName: "delete_team",
    action: "DELETE",
    entityType: "RoundRobinTeam",
    entityId: teamId,
    entityName: team.name,
    input: args,
    output: result,
    status: "confirmed",
    startTime,
  });

  return result;
}

export async function manageTeamMembers(orgId: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const confirm = (args.confirm as boolean) ?? false;
  const teamId = args.teamId as string;
  const action = args.action as "add" | "remove";
  const userIds = (args.userIds as string[]) ?? [];
  const roles = (args.roles as string[]) ?? [];
  const profiles = (args.profiles as string[]) ?? [];

  if (!teamId) return { error: "teamId is required" };
  if (action !== "add" && action !== "remove") return { error: "action must be 'add' or 'remove'" };

  const team = await prisma.roundRobinTeam.findFirst({
    where: { id: teamId, orgId },
    select: { id: true, name: true },
  });

  if (!team) return { error: "Team not found" };

  const hasUserIds = Array.isArray(userIds) && userIds.length > 0;
  const hasRoles = Array.isArray(roles) && roles.length > 0;
  const hasProfiles = Array.isArray(profiles) && profiles.length > 0;

  if (!hasUserIds && !hasRoles && !hasProfiles) {
    return { error: "At least one of userIds, roles, or profiles must be provided" };
  }

  // Resolve target users
  let users: { id: string; name: string; email: string }[];

  if (hasUserIds) {
    users = await prisma.user.findMany({
      where: { id: { in: userIds }, orgId, isLicensed: true, isActive: true },
      select: { id: true, name: true, email: true },
    });
    if (action === "add" && users.length !== userIds.length) {
      return { error: "One or more users not found or not licensed/active" };
    }
    if (action === "remove") {
      // For remove, users don't need to be licensed — find all in org
      users = await prisma.user.findMany({
        where: { id: { in: userIds }, orgId },
        select: { id: true, name: true, email: true },
      });
    }
  } else if (hasRoles) {
    users = await prisma.user.findMany({
      where: { orgId, isActive: true, isLicensed: true, role: { in: roles } },
      select: { id: true, name: true, email: true },
    });
  } else {
    users = await prisma.user.findMany({
      where: { orgId, isActive: true, isLicensed: true, profile: { in: profiles } },
      select: { id: true, name: true, email: true },
    });
  }

  if (users.length === 0) {
    return { error: "No matching users found" };
  }

  if (action === "add") {
    // Check which users are already members
    const existingMembers = await prisma.teamMember.findMany({
      where: { teamId, userId: { in: users.map((u) => u.id) } },
      select: { userId: true },
    });
    const existingSet = new Set(existingMembers.map((m) => m.userId));
    const toAdd = users.filter((u) => !existingSet.has(u.id));
    const alreadyMembers = users.filter((u) => existingSet.has(u.id));

    // ── Preview ──
    if (!confirm) {
      const preview = {
        action: "ADD_MEMBERS",
        teamName: team.name,
        willAdd: toAdd.map((u) => ({ id: u.id, name: u.name })),
        count: toAdd.length,
        alreadyMembers: alreadyMembers.map((u) => u.name),
      };

      await logAiAction({
        orgId,
        context: "teams",
        toolName: "manage_team_members",
        action: "ADD_MEMBERS",
        entityType: "TeamMember",
        entityId: teamId,
        entityName: `${team.name}: +${toAdd.length} members`,
        input: args,
        output: preview,
        status: "preview",
        startTime,
      });

      return preview;
    }

    // ── Execute ──
    const added: string[] = [];
    for (const user of toAdd) {
      await prisma.teamMember.create({
        data: { teamId, userId: user.id, status: "ACTIVE" },
      });
      added.push(user.id);

      await prisma.auditLog.create({
        data: {
          orgId,
          ...AI_ACTOR,
          action: "MEMBER_ADDED",
          entityType: "TeamMember",
          entityId: `${teamId}:${user.id}`,
          afterState: { teamId, userId: user.id, userName: user.name },
        },
      });
    }

    const result = {
      action: "ADD_MEMBERS",
      teamName: team.name,
      added: added.length,
      skipped: alreadyMembers.length,
      addedUsers: toAdd.map((u) => u.name),
    };

    await logAiAction({
      orgId,
      context: "teams",
      toolName: "manage_team_members",
      action: "ADD_MEMBERS",
      entityType: "TeamMember",
      entityId: teamId,
      entityName: `${team.name}: +${added.length} members`,
      input: args,
      output: result,
      status: "confirmed",
      startTime,
    });

    return result;
  } else {
    // action === "remove"
    const existingMembers = await prisma.teamMember.findMany({
      where: { teamId, userId: { in: users.map((u) => u.id) } },
      select: { id: true, userId: true },
    });
    const memberUserIds = new Set(existingMembers.map((m) => m.userId));
    const toRemove = users.filter((u) => memberUserIds.has(u.id));
    const notMembers = users.filter((u) => !memberUserIds.has(u.id));

    // ── Preview ──
    if (!confirm) {
      const preview = {
        action: "REMOVE_MEMBERS",
        teamName: team.name,
        willRemove: toRemove.map((u) => ({ id: u.id, name: u.name })),
        count: toRemove.length,
        notCurrentlyMembers: notMembers.map((u) => u.name),
      };

      await logAiAction({
        orgId,
        context: "teams",
        toolName: "manage_team_members",
        action: "REMOVE_MEMBERS",
        entityType: "TeamMember",
        entityId: teamId,
        entityName: `${team.name}: -${toRemove.length} members`,
        input: args,
        output: preview,
        status: "preview",
        startTime,
      });

      return preview;
    }

    // ── Execute ──
    const memberIdsToDelete = existingMembers
      .filter((m) => memberUserIds.has(m.userId))
      .map((m) => m.id);

    await prisma.teamMember.deleteMany({
      where: { id: { in: memberIdsToDelete } },
    });

    for (const user of toRemove) {
      await prisma.auditLog.create({
        data: {
          orgId,
          ...AI_ACTOR,
          action: "MEMBER_REMOVED",
          entityType: "TeamMember",
          entityId: `${teamId}:${user.id}`,
          beforeState: { teamId, userId: user.id, userName: user.name },
        },
      });
    }

    const result = {
      action: "REMOVE_MEMBERS",
      teamName: team.name,
      removed: toRemove.length,
      skipped: notMembers.length,
      removedUsers: toRemove.map((u) => u.name),
    };

    await logAiAction({
      orgId,
      context: "teams",
      toolName: "manage_team_members",
      action: "REMOVE_MEMBERS",
      entityType: "TeamMember",
      entityId: teamId,
      entityName: `${team.name}: -${toRemove.length} members`,
      input: args,
      output: result,
      status: "confirmed",
      startTime,
    });

    return result;
  }
}

export async function updateTeamWeights(orgId: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const confirm = (args.confirm as boolean) ?? false;
  const teamId = args.teamId as string;
  const weights = args.weights as Array<{ userId: string; weight: number }>;

  if (!teamId) return { error: "teamId is required" };
  if (!Array.isArray(weights) || weights.length === 0) {
    return { error: "weights must be a non-empty array of { userId, weight }" };
  }

  const team = await prisma.roundRobinTeam.findFirst({
    where: { id: teamId, orgId },
    select: { id: true, name: true, distributionType: true },
  });

  if (!team) return { error: "Team not found" };

  if (team.distributionType !== "weighted") {
    return { error: `Team "${team.name}" uses ${team.distributionType} distribution. Switch to weighted first.` };
  }

  // Validate all weights are positive
  for (const w of weights) {
    if (typeof w.weight !== "number" || w.weight < 0) {
      return { error: `Invalid weight for userId ${w.userId}: must be a non-negative number` };
    }
  }

  // Fetch current members
  const members = await prisma.teamMember.findMany({
    where: { teamId, userId: { in: weights.map((w) => w.userId) } },
    select: { id: true, userId: true, weight: true, user: { select: { name: true } } },
  });

  if (members.length !== weights.length) {
    const foundIds = new Set(members.map((m) => m.userId));
    const missing = weights.filter((w) => !foundIds.has(w.userId)).map((w) => w.userId);
    return { error: `Members not found in team: ${missing.join(", ")}` };
  }

  const memberMap = new Map(members.map((m) => [m.userId, m]));
  const changes = weights.map((w) => {
    const member = memberMap.get(w.userId)!;
    return {
      userId: w.userId,
      name: member.user.name,
      oldWeight: member.weight,
      newWeight: w.weight,
    };
  });

  // ── Preview ──
  if (!confirm) {
    const preview = {
      action: "UPDATE_WEIGHTS",
      teamName: team.name,
      changes,
    };

    await logAiAction({
      orgId,
      context: "teams",
      toolName: "update_team_weights",
      action: "UPDATE_WEIGHTS",
      entityType: "TeamMember",
      entityId: teamId,
      entityName: `${team.name}: ${changes.length} weight changes`,
      input: args,
      output: preview,
      status: "preview",
      startTime,
    });

    return preview;
  }

  // ── Execute ──
  for (const w of weights) {
    const member = memberMap.get(w.userId)!;
    await prisma.teamMember.update({
      where: { id: member.id },
      data: { weight: w.weight },
    });
  }

  await prisma.auditLog.create({
    data: {
      orgId,
      ...AI_ACTOR,
      action: "TEAM_WEIGHTS_UPDATED",
      entityType: "RoundRobinTeam",
      entityId: teamId,
      beforeState: Object.fromEntries(changes.map((c) => [c.userId, c.oldWeight])),
      afterState: Object.fromEntries(changes.map((c) => [c.userId, c.newWeight])),
    },
  });

  const result = {
    action: "UPDATE_WEIGHTS",
    teamName: team.name,
    updated: changes.length,
    changes,
  };

  await logAiAction({
    orgId,
    context: "teams",
    toolName: "update_team_weights",
    action: "UPDATE_WEIGHTS",
    entityType: "TeamMember",
    entityId: teamId,
    entityName: `${team.name}: ${changes.length} weight changes`,
    input: args,
    output: result,
    status: "confirmed",
    startTime,
  });

  return result;
}

// ─── Rule mutations ──────────────────────────────────────────────────────────

interface BranchInput {
  label?: string;
  priority: number;
  assignmentType: "USER" | "ROUND_ROBIN" | "QUEUE";
  assigneeUserId?: string | null;
  assigneeTeamId?: string | null;
  assigneeQueueId?: string | null;
  conditions: Array<{
    groupId: string;
    fieldName: string;
    fieldType?: string;
    operator: string;
    value?: string | null;
    sortOrder?: number;
  }>;
}

interface MatchConfigInput {
  checkLeads: boolean;
  checkContacts: boolean;
  checkAccounts: boolean;
  matchEmail: boolean;
  matchPhone: boolean;
  matchDomain: boolean;
  matchCompanyName?: boolean;
  fuzzyMatchMode?: "STRICT" | "FUZZY" | "AI_SMART";
  onLeadMatch: "SFDC_MERGE" | "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM";
  leadAssignmentType?: "USER" | "ROUND_ROBIN" | "QUEUE" | null;
  leadAssigneeUserId?: string | null;
  leadAssigneeTeamId?: string | null;
  leadAssigneeQueueId?: string | null;
  onContactMatch: "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP";
  contactAssignmentType?: "USER" | "ROUND_ROBIN" | "QUEUE" | null;
  contactAssigneeUserId?: string | null;
  contactAssigneeTeamId?: string | null;
  contactAssigneeQueueId?: string | null;
  onAccountMatch: "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP";
  accountAssignmentType?: "USER" | "ROUND_ROBIN" | "QUEUE" | null;
  accountAssigneeUserId?: string | null;
  accountAssigneeTeamId?: string | null;
  accountAssigneeQueueId?: string | null;
}

function buildMatchConfigData(mc: MatchConfigInput) {
  return {
    checkLeads: mc.checkLeads,
    checkContacts: mc.checkContacts,
    checkAccounts: mc.checkAccounts,
    matchEmail: mc.matchEmail,
    matchPhone: mc.matchPhone,
    matchDomain: mc.matchDomain,
    matchCompanyName: mc.matchCompanyName ?? false,
    fuzzyMatchMode: mc.fuzzyMatchMode ?? "STRICT",
    onLeadMatch: mc.onLeadMatch,
    leadAssignmentType: mc.leadAssignmentType ?? null,
    leadAssigneeUserId: mc.onLeadMatch === "ASSIGN_CUSTOM" && mc.leadAssignmentType === "USER" ? (mc.leadAssigneeUserId ?? null) : null,
    leadAssigneeTeamId: mc.onLeadMatch === "ASSIGN_CUSTOM" && mc.leadAssignmentType === "ROUND_ROBIN" ? (mc.leadAssigneeTeamId ?? null) : null,
    leadAssigneeQueueId: mc.onLeadMatch === "ASSIGN_CUSTOM" && mc.leadAssignmentType === "QUEUE" ? (mc.leadAssigneeQueueId ?? null) : null,
    onContactMatch: mc.onContactMatch,
    contactAssignmentType: mc.contactAssignmentType ?? null,
    contactAssigneeUserId: mc.onContactMatch === "ASSIGN_CUSTOM" && mc.contactAssignmentType === "USER" ? (mc.contactAssigneeUserId ?? null) : null,
    contactAssigneeTeamId: mc.onContactMatch === "ASSIGN_CUSTOM" && mc.contactAssignmentType === "ROUND_ROBIN" ? (mc.contactAssigneeTeamId ?? null) : null,
    contactAssigneeQueueId: mc.onContactMatch === "ASSIGN_CUSTOM" && mc.contactAssignmentType === "QUEUE" ? (mc.contactAssigneeQueueId ?? null) : null,
    onAccountMatch: mc.onAccountMatch,
    accountAssignmentType: mc.accountAssignmentType ?? null,
    accountAssigneeUserId: mc.onAccountMatch === "ASSIGN_CUSTOM" && mc.accountAssignmentType === "USER" ? (mc.accountAssigneeUserId ?? null) : null,
    accountAssigneeTeamId: mc.onAccountMatch === "ASSIGN_CUSTOM" && mc.accountAssignmentType === "ROUND_ROBIN" ? (mc.accountAssigneeTeamId ?? null) : null,
    accountAssigneeQueueId: mc.onAccountMatch === "ASSIGN_CUSTOM" && mc.accountAssignmentType === "QUEUE" ? (mc.accountAssigneeQueueId ?? null) : null,
  };
}

export async function createRule(orgId: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const confirm = (args.confirm as boolean) ?? false;

  const name = ((args.name as string) ?? "").trim();
  const objectType = (args.objectType as string) ?? "";
  const triggerEvent = (args.triggerEvent as string) ?? "INSERT";
  const assignmentType = args.assignmentType as string | undefined;
  const assigneeUserId = args.assigneeUserId as string | null | undefined;
  const assigneeTeamId = args.assigneeTeamId as string | null | undefined;
  const assigneeQueueId = args.assigneeQueueId as string | null | undefined;
  const isDryRun = (args.isDryRun as boolean) ?? false;
  const triggerName = (args.triggerName as string) ?? "";
  const triggerConditions = (args.triggerConditions as any[]) ?? [];
  const conditions = (args.conditions as any[]) ?? [];
  const branches = (args.branches as BranchInput[]) ?? [];
  const matchConfig = (args.matchConfig as MatchConfigInput | null) ?? null;
  const defaultOwnerType = (args.defaultOwnerType as string | null) ?? null;
  const defaultOwnerUserId = (args.defaultOwnerUserId as string | null) ?? null;
  const defaultOwnerTeamId = (args.defaultOwnerTeamId as string | null) ?? null;
  const defaultOwnerQueueId = (args.defaultOwnerQueueId as string | null) ?? null;

  // Scheduled/Search route fields
  const routeType = triggerEvent === "SEARCH" ? "SCHEDULED" : "REALTIME";
  const scheduleFrequency = (args.scheduleFrequency as string | null) ?? (triggerEvent === "SEARCH" ? "DAILY" : null);
  const scheduleTime = (args.scheduleTime as string | null) ?? (triggerEvent === "SEARCH" ? "06:00" : null);
  const scheduleTimezone = (args.scheduleTimezone as string | null) ?? (triggerEvent === "SEARCH" ? "UTC" : null);
  const searchCriteria = (args.searchCriteria as any[] | null) ?? null;

  // Validation
  if (!name) return { error: "name is required" };
  if (!["LEAD", "CONTACT", "ACCOUNT"].includes(objectType)) {
    return { error: "objectType must be LEAD, CONTACT, or ACCOUNT" };
  }
  if (!["INSERT", "UPDATE", "BOTH", "SEARCH"].includes(triggerEvent)) {
    return { error: "triggerEvent must be INSERT, UPDATE, BOTH, or SEARCH" };
  }

  const isNewStyle = branches.length > 0 || matchConfig !== null || defaultOwnerType !== null;
  if (!isNewStyle && !["USER", "ROUND_ROBIN", "QUEUE"].includes(assignmentType ?? "")) {
    return { error: "assignmentType must be USER, ROUND_ROBIN, or QUEUE (for rules without branches)" };
  }

  // Tier gating
  const limits = getTierLimits();
  if (limits.maxRules !== Infinity) {
    const ruleCount = await prisma.routingRule.count({ where: { orgId } });
    if (ruleCount >= limits.maxRules) {
      return { error: `Creating more than ${limits.maxRules} routing rules requires a Pro license upgrade.` };
    }
  }
  if (!limits.allowedTriggers.includes(objectType)) {
    return { error: `${objectType} triggers require a Pro license upgrade.` };
  }

  // Validate assignee references exist
  if (!isNewStyle && assignmentType === "ROUND_ROBIN" && assigneeTeamId) {
    const teamExists = await prisma.roundRobinTeam.findFirst({ where: { id: assigneeTeamId, orgId } });
    if (!teamExists) return { error: `Team ${assigneeTeamId} not found` };
  }
  if (!isNewStyle && assignmentType === "USER" && assigneeUserId) {
    const userExists = await prisma.user.findFirst({ where: { id: assigneeUserId, orgId } });
    if (!userExists) return { error: `User ${assigneeUserId} not found` };
  }

  // Determine next priority
  const maxPriorityRule = await prisma.routingRule.findFirst({
    where: { orgId, objectType: objectType as any },
    orderBy: { priority: "desc" },
    select: { priority: true },
  });
  const priority = (maxPriorityRule?.priority ?? 0) + 1;

  // ── Preview ──
  if (!confirm) {
    const preview = {
      action: "CREATE_RULE",
      name,
      objectType,
      triggerEvent,
      priority,
      assignmentType: isNewStyle ? null : assignmentType,
      branchCount: branches.length,
      conditionCount: conditions.length,
      triggerConditionCount: triggerConditions.length,
      hasMatchConfig: matchConfig !== null,
      hasDefaultOwner: defaultOwnerType !== null,
      isDryRun,
    };

    await logAiAction({
      orgId,
      context: "routing-rules",
      toolName: "create_rule",
      action: "CREATE",
      entityType: "RoutingRule",
      entityId: null,
      entityName: name,
      input: args,
      output: preview,
      status: "preview",
      startTime,
    });

    return preview;
  }

  // ── Execute ──
  const rule = await prisma.routingRule.create({
    data: {
      orgId,
      name,
      objectType: objectType as any,
      triggerEvent: triggerEvent as any,
      priority,
      assignmentType: isNewStyle ? null : (assignmentType as any),
      assigneeUserId: (!isNewStyle && assignmentType === "USER") ? (assigneeUserId ?? null) : null,
      assigneeTeamId: (!isNewStyle && assignmentType === "ROUND_ROBIN") ? (assigneeTeamId ?? null) : null,
      assigneeQueueId: (!isNewStyle && assignmentType === "QUEUE") ? (assigneeQueueId ?? null) : null,
      routeType: routeType as any,
      scheduleFrequency,
      scheduleTime,
      scheduleTimezone,
      searchCriteria: searchCriteria ?? undefined,
      isDryRun,
      triggerName: triggerName || "",
      triggerConditions: {
        create: triggerConditions.map((c: any) => ({
          groupId: c.groupId,
          fieldName: c.fieldName,
          fieldType: c.fieldType ?? "TEXT",
          operator: c.operator,
          value: c.value ?? null,
          sortOrder: c.sortOrder ?? 0,
        })),
      },
      defaultOwnerType: (defaultOwnerType as any) ?? null,
      defaultOwnerUserId: defaultOwnerType === "USER" ? defaultOwnerUserId : null,
      defaultOwnerTeamId: defaultOwnerType === "ROUND_ROBIN" ? defaultOwnerTeamId : null,
      defaultOwnerQueueId: defaultOwnerType === "QUEUE" ? defaultOwnerQueueId : null,
      conditions: {
        create: conditions.map((c: any) => ({
          groupId: c.groupId,
          fieldName: c.fieldName,
          operator: c.operator,
          value: c.value ?? null,
          sortOrder: c.sortOrder ?? 0,
        })),
      },
      branches: {
        create: branches.map((b) => ({
          label: b.label ?? null,
          priority: b.priority,
          assignmentType: b.assignmentType,
          assigneeUserId: b.assignmentType === "USER" ? (b.assigneeUserId ?? null) : null,
          assigneeTeamId: b.assignmentType === "ROUND_ROBIN" ? (b.assigneeTeamId ?? null) : null,
          assigneeQueueId: b.assignmentType === "QUEUE" ? (b.assigneeQueueId ?? null) : null,
          conditions: {
            create: b.conditions.map((c, ci) => ({
              groupId: c.groupId,
              fieldName: c.fieldName,
              fieldType: c.fieldType ?? "TEXT",
              operator: c.operator,
              value: c.value ?? null,
              sortOrder: c.sortOrder ?? ci,
            })),
          },
        })),
      },
      matchConfig: matchConfig
        ? { create: buildMatchConfigData(matchConfig) }
        : undefined,
    },
  });

  await prisma.auditLog.create({
    data: {
      orgId,
      ...AI_ACTOR,
      action: "RULE_CREATED",
      entityType: "RoutingRule",
      entityId: rule.id,
      afterState: { name: rule.name, objectType, priority, assignmentType: rule.assignmentType },
    },
  });

  await invalidateRulesCache(orgId, objectType);
  syncRoutingFlags(orgId).catch(() => {});

  const result = {
    action: "CREATE_RULE",
    rule: {
      id: rule.id,
      name: rule.name,
      objectType: rule.objectType,
      triggerEvent: rule.triggerEvent,
      priority: rule.priority,
      status: rule.status,
      assignmentType: rule.assignmentType,
      isDryRun: rule.isDryRun,
    },
  };

  await logAiAction({
    orgId,
    context: "routing-rules",
    toolName: "create_rule",
    action: "CREATE",
    entityType: "RoutingRule",
    entityId: rule.id,
    entityName: name,
    input: args,
    output: result,
    status: "confirmed",
    startTime,
  });

  return result;
}

export async function toggleRule(orgId: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const confirm = (args.confirm as boolean) ?? false;
  const ruleId = args.ruleId as string;
  if (!ruleId) return { error: "ruleId is required" };

  const rule = await prisma.routingRule.findFirst({
    where: { id: ruleId, orgId },
    select: { id: true, name: true, status: true, objectType: true },
  });

  if (!rule) return { error: "Rule not found" };

  const status = rule.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  // ── Preview ──
  if (!confirm) {
    const preview = {
      action: "TOGGLE_RULE",
      ruleId: rule.id,
      ruleName: rule.name,
      currentStatus: rule.status,
      newStatus: status,
    };

    await logAiAction({
      orgId,
      context: "routing-rules",
      toolName: "toggle_rule",
      action: "TOGGLE",
      entityType: "RoutingRule",
      entityId: ruleId,
      entityName: rule.name,
      input: args,
      output: preview,
      status: "preview",
      startTime,
    });

    return preview;
  }

  // ── Execute ──
  const updated = await prisma.routingRule.update({
    where: { id: ruleId },
    data: { status: status as any },
  });

  await prisma.auditLog.create({
    data: {
      orgId,
      ...AI_ACTOR,
      action: status === "ACTIVE" ? "RULE_ACTIVATED" : "RULE_DEACTIVATED",
      entityType: "RoutingRule",
      entityId: ruleId,
      beforeState: { status: rule.status },
      afterState: { status },
    },
  });

  await invalidateRulesCache(orgId, rule.objectType);
  syncRoutingFlags(orgId).catch(() => {});

  const result = {
    action: "TOGGLE_RULE",
    ruleName: updated.name,
    previousStatus: rule.status,
    newStatus: status,
  };

  await logAiAction({
    orgId,
    context: "routing-rules",
    toolName: "toggle_rule",
    action: "TOGGLE",
    entityType: "RoutingRule",
    entityId: ruleId,
    entityName: rule.name,
    input: args,
    output: result,
    status: "confirmed",
    startTime,
  });

  return result;
}

export async function deleteRule(orgId: string, args: Record<string, unknown>) {
  const startTime = Date.now();
  const confirm = (args.confirm as boolean) ?? false;
  const ruleId = args.ruleId as string;

  if (!ruleId) return { error: "ruleId is required" };

  const rule = await prisma.routingRule.findFirst({
    where: { id: ruleId, orgId },
    select: {
      id: true,
      name: true,
      objectType: true,
      status: true,
      triggerEvent: true,
      _count: { select: { branches: true, conditions: true } },
    },
  });

  if (!rule) return { error: "Rule not found" };

  // Check recent routing logs to warn about impact
  const recentLogCount = await prisma.routingLog.count({
    where: {
      ruleId,
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      status: "SUCCESS",
    },
  });

  // ── Preview ──
  if (!confirm) {
    const preview = {
      action: "DELETE_RULE",
      ruleId: rule.id,
      ruleName: rule.name,
      objectType: rule.objectType,
      status: rule.status,
      triggerEvent: rule.triggerEvent,
      branchCount: rule._count.branches,
      conditionCount: rule._count.conditions,
      recentRoutingsLast7Days: recentLogCount,
      warning: rule.status === "ACTIVE"
        ? `This rule is currently ACTIVE and routed ${recentLogCount} records in the last 7 days. Deleting it will stop all routing for its conditions.`
        : recentLogCount > 0
          ? `This rule routed ${recentLogCount} records in the last 7 days before being paused.`
          : null,
    };

    await logAiAction({
      orgId,
      context: "routing-rules",
      toolName: "delete_rule",
      action: "DELETE",
      entityType: "RoutingRule",
      entityId: ruleId,
      entityName: rule.name,
      input: args,
      output: preview,
      status: "preview",
      startTime,
    });

    return preview;
  }

  // ── Execute ──
  await prisma.routingRule.delete({ where: { id: ruleId } });

  await prisma.auditLog.create({
    data: {
      orgId,
      ...AI_ACTOR,
      action: "RULE_DELETED",
      entityType: "RoutingRule",
      entityId: ruleId,
      beforeState: { name: rule.name, objectType: rule.objectType, status: rule.status },
    },
  });

  await invalidateRulesCache(orgId, rule.objectType);
  syncRoutingFlags(orgId).catch(() => {});

  const result = {
    action: "DELETE_RULE",
    deletedRule: rule.name,
    objectType: rule.objectType,
  };

  await logAiAction({
    orgId,
    context: "routing-rules",
    toolName: "delete_rule",
    action: "DELETE",
    entityType: "RoutingRule",
    entityId: ruleId,
    entityName: rule.name,
    input: args,
    output: result,
    status: "confirmed",
    startTime,
  });

  return result;
}
