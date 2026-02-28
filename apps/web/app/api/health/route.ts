import { NextResponse } from "next/server";

// GET /api/health — lightweight liveness probe used by Docker healthcheck and CLI
export async function GET() {
  return NextResponse.json({ ok: true }, { status: 200 });
}
