import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";
import { invalidateRulesCache } from "@/lib/invalidate-rules-cache";

// POST /api/rules/reorder — body: { ruleIds: string[] } (full ordered list)
export async function POST(req: NextRequest) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const body = await req.json();
    const { ruleIds } = body;

    if (!Array.isArray(ruleIds) || ruleIds.length === 0) {
      return NextResponse.json({ error: "ruleIds must be a non-empty array" }, { status: 400 });
    }

    // Verify all rules belong to this org and get objectType for cache invalidation
    const rules = await prisma.routingRule.findMany({
      where: { id: { in: ruleIds }, orgId },
      select: { id: true, objectType: true },
    });

    if (rules.length !== ruleIds.length) {
      return NextResponse.json({ error: "One or more rules not found" }, { status: 404 });
    }

    // Update priorities in a transaction
    await prisma.$transaction(
      ruleIds.map((id: string, idx: number) =>
        prisma.routingRule.update({
          where: { id },
          data: { priority: idx + 1 },
        })
      )
    );

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "RULES_REORDERED",
        entityType: "RoutingRule",
        entityId: ruleIds[0],
        afterState: { ruleIds },
      },
    });

    // Invalidate cache for the affected object type (all rules in a reorder share one type)
    if (rules[0]) {
      await invalidateRulesCache(orgId, rules[0].objectType);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("POST /api/rules/reorder error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
