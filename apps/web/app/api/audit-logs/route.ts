import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { getTierLimits, upgradeRequiredResponse } from "@/lib/license";

// GET /api/audit-logs?page=1&limit=50&from=&to=&actorId=&action=&entityType=
export async function GET(req: NextRequest) {
  try {
    const limits = getTierLimits();
    if (!limits.auditLog) {
      return upgradeRequiredResponse("Audit logs");
    }

    const orgId = await getOrgIdFromHeaders();
    const p = req.nextUrl.searchParams;

    const page = Math.max(1, parseInt(p.get("page") ?? "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(p.get("limit") ?? "50", 10)));
    const skip = (page - 1) * limit;

    const from = p.get("from");
    const to = p.get("to");
    const actorId = p.get("actorId");
    const action = p.get("action");
    const entityType = p.get("entityType");

    const where: Prisma.AuditLogWhereInput = { orgId };

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (actorId) where.actorId = actorId;
    if (action) where.action = { contains: action, mode: "insensitive" };
    if (entityType) where.entityType = entityType;

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
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
    console.error("GET /api/audit-logs error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
