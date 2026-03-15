import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/fields?object=LEAD — list field schemas for the given object type
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const objectParam = req.nextUrl.searchParams.get("object")?.toUpperCase() ?? req.nextUrl.searchParams.get("objectType")?.toUpperCase() ?? "LEAD";
    const customOnly = req.nextUrl.searchParams.get("customOnly") === "true";

    if (!["LEAD", "CONTACT", "ACCOUNT", "USER"].includes(objectParam)) {
      return NextResponse.json({ error: "Invalid object type" }, { status: 400 });
    }

    // For USER object type, we query LEAD fields that end with __c as a placeholder
    // since FieldSchema doesn't have a USER enum value yet
    const where: Record<string, unknown> = { orgId };
    if (objectParam === "USER") {
      // Return custom fields from LEAD as proxy (User custom fields share naming conventions)
      where.objectType = "LEAD";
      where.fieldApiName = { endsWith: "__c" };
    } else {
      where.objectType = objectParam as "LEAD" | "CONTACT" | "ACCOUNT";
    }

    if (customOnly) {
      where.fieldApiName = { endsWith: "__c" };
    }

    const fields = await prisma.fieldSchema.findMany({
      where,
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
