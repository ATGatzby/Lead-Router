import { NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";

/**
 * POST /api/analytics/conversions/refresh
 *
 * Triggers an immediate conversion check by calling the engine's
 * analytics queue endpoint.
 */
export async function POST() {
  try {
    await getOrgIdFromHeaders(); // auth check

    const engineUrl = process.env.ENGINE_URL;
    if (!engineUrl) {
      return NextResponse.json({ error: "Engine URL not configured" }, { status: 500 });
    }

    const res = await fetch(`${engineUrl}/analytics/conversion-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      return NextResponse.json({ error: "Failed to trigger conversion check" }, { status: 502 });
    }

    return NextResponse.json({ status: "queued" });
  } catch (err) {
    console.error("POST /api/analytics/conversions/refresh error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
