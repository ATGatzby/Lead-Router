import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/fields?object=LEAD — list field schemas for the given object type
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const objectType = req.nextUrl.searchParams.get("object")?.toUpperCase() ?? "LEAD";

    if (!["LEAD", "CONTACT", "ACCOUNT"].includes(objectType)) {
      return NextResponse.json({ error: "Invalid object type" }, { status: 400 });
    }

    const fields = await prisma.fieldSchema.findMany({
      where: { orgId, objectType: objectType as "LEAD" | "CONTACT" | "ACCOUNT" },
      orderBy: { fieldLabel: "asc" },
      select: {
        id: true,
        fieldApiName: true,
        fieldLabel: true,
        fieldType: true,
        picklistValues: true,
        syncedAt: true,
      },
    });

    return NextResponse.json({ fields });
  } catch (err) {
    console.error("GET /api/fields error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
