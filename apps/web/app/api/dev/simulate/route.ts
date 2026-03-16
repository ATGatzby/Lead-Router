import { NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";

/**
 * POST /api/dev/simulate
 * Proxies to the engine's simulation endpoint to start a fake bulk run
 * that pushes mock records through the real BullMQ pipeline.
 */
export async function POST(req: Request) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const body = await req.json();

    const engineUrl = process.env.ENGINE_URL ?? "http://engine:3001";
    const internalKey = process.env.INTERNAL_API_KEY;

    const res = await fetch(`${engineUrl}/dev/simulate-bulk-run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(internalKey ? { Authorization: `Bearer ${internalKey}` } : {}),
        "X-Org-Id": orgId,
      },
      body: JSON.stringify({ ...body, orgId }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(data, { status: res.status });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    console.error("POST /api/dev/simulate error:", err);
    return NextResponse.json(
      { error: err.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
