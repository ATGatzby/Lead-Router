import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";

/**
 * POST /api/bulk-run/:runId/cancel
 * Proxies cancel request to the engine, which sets a Redis flag
 * that the bulk-search orchestrator checks between batches.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const orgId = await getOrgIdFromHeaders();

    // Verify the run belongs to this org and is still running
    const run = await prisma.bulkSearchRun.findFirst({
      where: { id: runId, orgId },
      select: { id: true, status: true },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (run.status !== "RUNNING") {
      return NextResponse.json(
        { error: "Run is not active", status: run.status },
        { status: 409 }
      );
    }

    // Forward cancel to engine
    const engineUrl = process.env.ENGINE_URL ?? "http://engine:3001";
    const internalKey = process.env.INTERNAL_API_KEY;

    const engineRes = await fetch(`${engineUrl}/bulk-run/${runId}/cancel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalKey ? { Authorization: `Bearer ${internalKey}` } : {}),
        "X-Org-Id": orgId,
      },
    });

    if (!engineRes.ok) {
      const errText = await engineRes.text();
      console.error(`[cancel] Engine cancel failed: ${engineRes.status}`, errText);
      return NextResponse.json(
        { error: "Failed to cancel run" },
        { status: 502 }
      );
    }

    return NextResponse.json({ cancelled: true });
  } catch (err: any) {
    console.error("POST /api/bulk-run/:runId/cancel error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
