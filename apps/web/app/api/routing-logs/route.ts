import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/routing-logs?page=1&limit=50&from=&to=&object=&status=&assignee=&ruleId=
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const p = req.nextUrl.searchParams;

    const page = Math.max(1, parseInt(p.get("page") ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(p.get("limit") ?? "50", 10)));
    const skip = (page - 1) * limit;

    const from = p.get("from");
    const to = p.get("to");
    const object = p.get("object")?.toUpperCase();
    const status = p.get("status")?.toUpperCase();
    const assignee = p.get("assignee");
    const ruleId = p.get("ruleId");

    const VALID_OBJECTS = ["LEAD", "CONTACT", "ACCOUNT"];
    const VALID_STATUSES = ["SUCCESS", "FAILED", "UNMATCHED", "RETRY", "MERGED"];

    const where: Prisma.RoutingLogWhereInput = { orgId };

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (object && VALID_OBJECTS.includes(object)) {
      where.objectType = object as "LEAD" | "CONTACT" | "ACCOUNT";
    }
    if (status && VALID_STATUSES.includes(status)) {
      where.status = status as "SUCCESS" | "FAILED" | "UNMATCHED" | "RETRY";
    }
    if (assignee) {
      where.assigneeName = { contains: assignee, mode: "insensitive" };
    }
    if (ruleId) {
      where.ruleId = ruleId;
    }

    const [total, logs] = await Promise.all([
      prisma.routingLog.count({ where }),
      prisma.routingLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
    ]);

    return NextResponse.json({
      logs,
      total,
      page,
      pageCount: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("GET /api/routing-logs error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
