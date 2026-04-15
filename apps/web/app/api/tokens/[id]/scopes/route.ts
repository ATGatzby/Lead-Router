import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

const VALID_SCOPES = ["read", "route", "agent"] as const;

// PATCH /api/tokens/:id/scopes — add a scope to an existing token
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;
    const { id } = await params;

    const body = await req.json();
    const { scope } = body;

    if (!scope || !VALID_SCOPES.includes(scope)) {
      return NextResponse.json(
        { error: `Invalid scope. Must be one of: ${VALID_SCOPES.join(", ")}` },
        { status: 400 },
      );
    }

    // Verify the token belongs to this org and is active
    const existing = await prisma.apiToken.findUnique({
      where: { id },
      select: { id: true, orgId: true, name: true, scopes: true, revokedAt: true },
    });

    if (!existing || existing.orgId !== orgId) {
      return NextResponse.json({ error: "Token not found" }, { status: 404 });
    }
    if (existing.revokedAt) {
      return NextResponse.json({ error: "Cannot modify a revoked token" }, { status: 400 });
    }

    // Check if scope already exists
    if (existing.scopes.includes(scope)) {
      return NextResponse.json({ scopes: existing.scopes, message: "Scope already present" });
    }

    const updatedScopes = [...existing.scopes, scope];
    const updated = await prisma.apiToken.update({
      where: { id },
      data: { scopes: updatedScopes },
      select: { id: true, scopes: true },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "API_TOKEN_SCOPE_ADDED",
        entityType: "ApiToken",
        entityId: id,
        beforeState: { scopes: existing.scopes },
        afterState: { scopes: updated.scopes },
      },
    });

    return NextResponse.json({ scopes: updated.scopes });
  } catch (err) {
    console.error("PATCH /api/tokens/[id]/scopes error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
