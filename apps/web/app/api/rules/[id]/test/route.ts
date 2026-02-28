import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { evaluateRule } from "@/lib/evaluator";

// POST /api/rules/:id/test — dry-run a single rule against a sample record
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orgId = await getOrgIdFromHeaders();

    const rule = await prisma.routingRule.findFirst({
      where: { id, orgId },
      include: { conditions: { orderBy: { sortOrder: "asc" } } },
    });
    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    const body = await req.json();
    const record = body.record;

    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return NextResponse.json(
        { error: "record must be a JSON object" },
        { status: 400 }
      );
    }

    const result = evaluateRule(
      record as Record<string, unknown>,
      rule.conditions.map((c) => ({
        groupId: c.groupId,
        fieldName: c.fieldName,
        operator: c.operator,
        value: c.value,
      }))
    );

    return NextResponse.json({
      ruleId: rule.id,
      ruleName: rule.name,
      status: rule.status,
      matched: result.matched,
      isCatchAll: rule.conditions.length === 0,
      groups: result.groups,
    });
  } catch (err) {
    console.error("POST /api/rules/:id/test error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
