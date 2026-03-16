import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { getRedis } from "@/lib/redis";

const REDIS_KEY = "license:heartbeat:latest";

// GET /api/license/status
export async function GET(_req: NextRequest) {
  try {
    // Ensure caller is authenticated
    await getOrgIdFromHeaders();

    const redis = getRedis();
    const raw = await redis.get(REDIS_KEY);
    const heartbeat = raw ? JSON.parse(raw) : null;

    const tier = process.env.LICENSE_TIER || "free";
    const licenseKey = process.env.LICENSE_KEY || "";

    // Mask the license key for display (show first 4 + last 4 chars)
    const maskedKey = licenseKey.length > 8
      ? `${licenseKey.slice(0, 4)}${"*".repeat(licenseKey.length - 8)}${licenseKey.slice(-4)}`
      : licenseKey ? "****" : null;

    return NextResponse.json({
      tier,
      licenseKey: maskedKey,
      lastHeartbeat: heartbeat?.checkedAt ?? null,
      validUntil: heartbeat?.validUntil ?? null,
      graceActive: heartbeat?.graceActive ?? false,
      daysRemaining: heartbeat?.daysRemaining ?? null,
      error: heartbeat?.error ?? null,
    });
  } catch (err) {
    console.error("GET /api/license/status error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
