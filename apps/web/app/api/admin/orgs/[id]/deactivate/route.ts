import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { setOrgSuspended } from "@/lib/org-status";

// POST /api/admin/orgs/[id]/deactivate
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.organization.update({
      where: { id },
      data: { isActive: false },
    });
    await setOrgSuspended(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/orgs/[id]/deactivate error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
