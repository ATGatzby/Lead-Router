import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { invalidateRulesCache } from "@/lib/invalidate-rules-cache";
import { invalidateFlowCache } from "@/lib/invalidate-flow-cache";

const VALID_OBJECT_TYPES = ["LEAD", "CONTACT", "ACCOUNT"];
const VALID_MODES = ["CLASSIC", "FLOW"];

const DEFAULT_MODE: Record<string, string> = {
  LEAD: "CLASSIC",
  CONTACT: "CLASSIC",
  ACCOUNT: "CLASSIC",
};

// GET /api/routing-mode — returns per-object routing mode
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { routingMode: true },
    });

    const mode = {
      ...DEFAULT_MODE,
      ...((org?.routingMode as Record<string, string>) ?? {}),
    };

    return NextResponse.json({ modes: mode });
  } catch (err) {
    console.error("GET /api/routing-mode error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/routing-mode — update routing mode for a specific object type
export async function PUT(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const body = await req.json();
    const { objectType, mode } = body;

    if (!objectType || !VALID_OBJECT_TYPES.includes(objectType)) {
      return NextResponse.json({ error: "Invalid objectType" }, { status: 400 });
    }
    if (!mode || !VALID_MODES.includes(mode)) {
      return NextResponse.json({ error: "Invalid mode — must be CLASSIC or FLOW" }, { status: 400 });
    }

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { routingMode: true },
    });

    const currentMode = {
      ...DEFAULT_MODE,
      ...((org?.routingMode as Record<string, string>) ?? {}),
    };
    currentMode[objectType] = mode;

    await prisma.organization.update({
      where: { id: orgId },
      data: { routingMode: currentMode },
    });

    // Invalidate both caches so the engine picks up the mode change
    await invalidateRulesCache(orgId, objectType);
    await invalidateFlowCache(orgId, objectType);

    return NextResponse.json({ modes: currentMode });
  } catch (err) {
    console.error("PUT /api/routing-mode error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
