import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// POST /api/routing-logs/:id/dismiss — hide from failed panel
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const { id } = await params;

    const log = await prisma.routingLog.findUnique({ where: { id } });

    if (!log) {
      return NextResponse.json({ error: "Log not found" }, { status: 404 });
    }
    if (log.orgId !== orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.routingLog.update({
      where: { id },
      data: { dismissed: true },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/routing-logs/[id]/dismiss error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
