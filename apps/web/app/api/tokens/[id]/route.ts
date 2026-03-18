import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// DELETE /api/tokens/:id — revoke a token (soft-delete via revokedAt)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;
    const { id } = await params;

    // Verify the token belongs to this org
    const existing = await prisma.apiToken.findUnique({
      where: { id },
      select: { id: true, orgId: true, name: true, revokedAt: true },
    });

    if (!existing || existing.orgId !== orgId) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }
    if (existing.revokedAt) {
      return NextResponse.json({ error: "Token already revoked" }, { status: 400 });
    }

    await prisma.apiToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "API_TOKEN_REVOKED",
        entityType: "ApiToken",
        entityId: id,
        beforeState: { name: existing.name },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/tokens/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
