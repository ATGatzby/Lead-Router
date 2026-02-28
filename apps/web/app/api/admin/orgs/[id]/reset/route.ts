import { NextRequest, NextResponse } from "next/server";
import { prisma, startOfNextMonth, RULES_INVALIDATE_CHANNEL } from "@lead-routing/db";
import { getRedis } from "@/lib/redis";

// POST /api/admin/orgs/[id]/reset
// Body: { mode: "soft" | "hard" }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { mode } = await req.json();

    if (!mode || !["soft", "hard"].includes(mode)) {
      return NextResponse.json({ error: "mode must be 'soft' or 'hard'" }, { status: 400 });
    }

    // Confirm org exists
    const org = await prisma.organization.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!org) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const nextReset = startOfNextMonth();

    if (mode === "soft") {
      await prisma.$transaction([
        prisma.routingLog.deleteMany({ where: { orgId: id } }),
        prisma.organization.update({
          where: { id },
          data: { routingQuotaUsed: 0, quotaResetAt: nextReset },
        }),
      ]);
    } else {
      // Hard reset — delete all data in FK-safe order, preserve org + billingInfo
      // Step 1: Get all ruleIds for the org (RuleCondition has no direct orgId)
      const rules = await prisma.routingRule.findMany({
        where: { orgId: id },
        select: { id: true },
      });
      const ruleIds = rules.map((r) => r.id);

      // Step 2: Get all teamIds for the org (TeamMember has no direct orgId)
      const teams = await prisma.roundRobinTeam.findMany({
        where: { orgId: id },
        select: { id: true },
      });
      const teamIds = teams.map((t) => t.id);

      await prisma.$transaction([
        ...(ruleIds.length > 0
          ? [prisma.ruleCondition.deleteMany({ where: { ruleId: { in: ruleIds } } })]
          : []),
        prisma.routingRule.deleteMany({ where: { orgId: id } }),
        ...(teamIds.length > 0
          ? [prisma.teamMember.deleteMany({ where: { teamId: { in: teamIds } } })]
          : []),
        prisma.roundRobinTeam.deleteMany({ where: { orgId: id } }),
        prisma.routingLog.deleteMany({ where: { orgId: id } }),
        prisma.auditLog.deleteMany({ where: { orgId: id } }),
        prisma.fieldSchema.deleteMany({ where: { orgId: id } }),
        prisma.sfdcQueue.deleteMany({ where: { orgId: id } }),
        prisma.user.deleteMany({ where: { orgId: id } }),
        prisma.organization.update({
          where: { id },
          data: {
            seatsUsed: 0,
            routingQuotaUsed: 0,
            quotaResetAt: nextReset,
            onboardingDone: false,
          },
        }),
      ]);

      // Invalidate the engine's in-memory rule cache for all object types
      try {
        const redis = getRedis();
        for (const objectType of ["LEAD", "CONTACT", "ACCOUNT"]) {
          await redis.publish(
            RULES_INVALIDATE_CHANNEL,
            JSON.stringify({ orgId: id, objectType })
          );
        }
      } catch (redisErr) {
        console.error("[admin/reset] Redis cache invalidation failed:", redisErr);
        // Non-fatal — engine will serve stale cache until next restart or rule change
      }
    }

    return NextResponse.json({ ok: true, mode });
  } catch (err) {
    console.error("POST /api/admin/orgs/[id]/reset error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
