import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

const VALID_OBJECT_TYPES = ["LEAD", "CONTACT", "ACCOUNT"];

// GET /api/flows — list all flows for the org
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const flows = await prisma.routingFlow.findMany({
      where: { orgId },
      include: {
        nodes: { orderBy: { sortOrder: "asc" } },
        edges: { orderBy: { sortOrder: "asc" } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ flows });
  } catch (err) {
    console.error("GET /api/flows error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/flows — create a new flow with a default ENTRY node
export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const body = await req.json();
    const { objectType, name } = body;

    if (!objectType || !VALID_OBJECT_TYPES.includes(objectType)) {
      return NextResponse.json({ error: "Invalid objectType" }, { status: 400 });
    }
    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    // Enforce one flow per org+objectType (unique constraint)
    const existing = await prisma.routingFlow.findUnique({
      where: { orgId_objectType: { orgId, objectType } },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A flow already exists for ${objectType}. Use PUT to update it.` },
        { status: 409 }
      );
    }

    const flow = await prisma.routingFlow.create({
      data: {
        orgId,
        objectType,
        name: name.trim(),
        nodes: {
          create: [
            {
              type: "ENTRY",
              label: "Record Enters",
              positionX: 400,
              positionY: 50,
              sortOrder: 0,
            },
          ],
        },
      },
      include: {
        nodes: { orderBy: { sortOrder: "asc" } },
        edges: { orderBy: { sortOrder: "asc" } },
      },
    });

    return NextResponse.json({ flow }, { status: 201 });
  } catch (err) {
    console.error("POST /api/flows error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
