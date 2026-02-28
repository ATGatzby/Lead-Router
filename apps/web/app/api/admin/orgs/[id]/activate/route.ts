import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { clearOrgSuspended } from "@/lib/org-status";

// POST /api/admin/orgs/[id]/activate
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await prisma.organization.update({
      where: { id },
      data: { isActive: true },
    });
    await clearOrgSuspended(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/admin/orgs/[id]/activate error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
