import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";

/**
 * GET /api/bulk-run/:runId/status
 * Proxies to the engine's bulk-run status endpoint for live progress,
 * falls back to DB for completed runs.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const orgId = await getOrgIdFromHeaders();

    // Verify the run belongs to this org
    const run = await prisma.bulkSearchRun.findFirst({
      where: { id: runId, orgId },
      select: {
        id: true,
        status: true,
        recordsFound: true,
        recordsProcessed: true,
        recordsRouted: true,
        recordsFailed: true,
        recordsSkipped: true,
        startedAt: true,
        completedAt: true,
        durationMs: true,
        error: true,
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    // If still running, try to get live progress from engine
    if (run.status === "RUNNING") {
      const engineUrl = process.env.ENGINE_URL ?? "http://engine:3001";
      const internalKey = process.env.INTERNAL_API_KEY;

      try {
        const engineRes = await fetch(`${engineUrl}/bulk-run/${runId}/status`, {
          headers: {
            ...(internalKey ? { Authorization: `Bearer ${internalKey}` } : {}),
            "X-Org-Id": orgId,
          },
        });

        if (engineRes.ok) {
          const liveStatus = await engineRes.json();
          return NextResponse.json({
            ...liveStatus,
            recordsFound: run.recordsFound, // DB has authoritative recordsFound
          });
        }
      } catch {
        // Engine unreachable — fall through to DB data
      }
    }

    // Return DB data for completed/failed/cancelled runs
    return NextResponse.json({ ...run, phase: "complete", writePending: 0 });
  } catch (err: any) {
    console.error("GET /api/bulk-run/:runId/status error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
