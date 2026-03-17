import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { invalidateFlowCache } from "@/lib/invalidate-flow-cache";

const VALID_OBJECT_TYPES = ["LEAD", "CONTACT", "ACCOUNT"];

// GET /api/flows/:objectType — get flow detail with nodes and edges
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ objectType: string }> }
) {
  try {
    const { objectType } = await params;
    const orgId = await getOrgIdFromHeaders();

    if (!VALID_OBJECT_TYPES.includes(objectType)) {
      return NextResponse.json({ error: "Invalid objectType" }, { status: 400 });
    }

    const flow = await prisma.routingFlow.findUnique({
      where: { orgId_objectType: { orgId, objectType: objectType as any } },
      include: {
        nodes: { orderBy: { sortOrder: "asc" } },
        edges: { orderBy: { sortOrder: "asc" } },
      },
    });

    if (!flow) {
      return NextResponse.json({ error: "Flow not found" }, { status: 404 });
    }

    return NextResponse.json({ flow });
  } catch (err) {
    console.error("GET /api/flows/:objectType error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/flows/:objectType — replace all nodes and edges for a flow
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ objectType: string }> }
) {
  try {
    const { objectType } = await params;
    const orgId = await getOrgIdFromHeaders();

    if (!VALID_OBJECT_TYPES.includes(objectType)) {
      return NextResponse.json({ error: "Invalid objectType" }, { status: 400 });
    }

    const existing = await prisma.routingFlow.findUnique({
      where: { orgId_objectType: { orgId, objectType: objectType as any } },
      select: { id: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Flow not found" }, { status: 404 });
    }

    const body = await req.json();
    const {
      name,
      triggerEvent,
      isDryRun,
      nodes = [],
      edges = [],
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    if (triggerEvent && !["INSERT", "UPDATE", "BOTH"].includes(triggerEvent)) {
      return NextResponse.json({ error: "Invalid triggerEvent" }, { status: 400 });
    }

    const flowId = existing.id;

    // Use a transaction to atomically replace nodes + edges
    const updated = await prisma.$transaction(async (tx) => {
      // 1. Delete edges first (FK → FlowNode)
      await tx.flowEdge.deleteMany({ where: { flowId } });

      // 2. Delete existing nodes
      await tx.flowNode.deleteMany({ where: { flowId } });

      // 3. Create new nodes
      if (nodes.length > 0) {
        await tx.flowNode.createMany({
          data: nodes.map(
            (n: { id: string; type: string; label?: string; positionX?: number; positionY?: number; config?: any }, i: number) => ({
              id: n.id,
              flowId,
              type: n.type as any,
              label: n.label ?? null,
              positionX: n.positionX ?? 0,
              positionY: n.positionY ?? 0,
              config: n.config ?? undefined,
              sortOrder: i,
            })
          ),
        });
      }

      // 4. Create new edges
      if (edges.length > 0) {
        await tx.flowEdge.createMany({
          data: edges.map(
            (e: { id: string; fromId: string; toId: string; label?: string; sourceHandle?: string; targetHandle?: string }, i: number) => ({
              id: e.id,
              flowId,
              fromId: e.fromId,
              toId: e.toId,
              label: e.label ?? null,
              sourceHandle: e.sourceHandle ?? null,
              targetHandle: e.targetHandle ?? null,
              sortOrder: i,
            })
          ),
        });
      }

      // 5. Update flow metadata
      const flow = await tx.routingFlow.update({
        where: { id: flowId },
        data: {
          name: name.trim(),
          triggerEvent: triggerEvent ?? undefined,
          isDryRun: isDryRun ?? false,
          version: { increment: 1 },
        },
        include: {
          nodes: { orderBy: { sortOrder: "asc" } },
          edges: { orderBy: { sortOrder: "asc" } },
        },
      });

      return flow;
    });

    await invalidateFlowCache(orgId, objectType);

    return NextResponse.json({ flow: updated });
  } catch (err) {
    console.error("PUT /api/flows/:objectType error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
