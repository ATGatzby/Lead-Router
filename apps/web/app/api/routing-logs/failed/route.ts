import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/routing-logs/failed — non-dismissed FAILED logs
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const logs = await prisma.routingLog.findMany({
      where: { orgId, status: "FAILED", dismissed: false },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ logs });
  } catch (err) {
    console.error("GET /api/routing-logs/failed error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
