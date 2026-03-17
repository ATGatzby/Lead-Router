import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { invalidateFlowCache } from "@/lib/invalidate-flow-cache";

const VALID_OBJECT_TYPES = ["LEAD", "CONTACT", "ACCOUNT"];

// POST /api/flows/:objectType/publish — activate or deactivate a flow
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ objectType: string }> }
) {
  try {
    const { objectType } = await params;
    const orgId = await getOrgIdFromHeaders();

    if (!VALID_OBJECT_TYPES.includes(objectType)) {
      return NextResponse.json({ error: "Invalid objectType" }, { status: 400 });
    }

    const body = await req.json();
    const { action } = body;

    if (!action || !["publish", "unpublish"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid action — must be 'publish' or 'unpublish'" },
        { status: 400 }
      );
    }

    const existing = await prisma.routingFlow.findUnique({
      where: { orgId_objectType: { orgId, objectType: objectType as any } },
      select: { id: true, status: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Flow not found" }, { status: 404 });
    }

    const isPublish = action === "publish";

    const flow = await prisma.routingFlow.update({
      where: { id: existing.id },
      data: {
        status: isPublish ? "ACTIVE" : "INACTIVE",
        publishedAt: isPublish ? new Date() : undefined,
      },
      include: {
        nodes: { orderBy: { sortOrder: "asc" } },
        edges: { orderBy: { sortOrder: "asc" } },
      },
    });

    await invalidateFlowCache(orgId, objectType);

    return NextResponse.json({ flow });
  } catch (err) {
    console.error("POST /api/flows/:objectType/publish error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
