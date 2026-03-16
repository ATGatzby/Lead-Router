import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const url = new URL(req.url, "http://localhost");
    const context = url.searchParams.get("context");
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
      200
    );

    const logs = await prisma.aiAgentLog.findMany({
      where: {
        orgId,
        ...(context ? { context } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        context: true,
        toolName: true,
        action: true,
        entityType: true,
        entityId: true,
        entityName: true,
        input: true,
        output: true,
        status: true,
        error: true,
        actorName: true,
        durationMs: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ logs });
  } catch (err) {
    console.error("[AI Activity Error]", err);
    const message =
      err instanceof Error ? err.message : "Failed to fetch activity";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
