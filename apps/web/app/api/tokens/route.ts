import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// GET /api/tokens — list active (non-revoked) tokens for the org
export async function GET(_req: NextRequest) {
  try {
    const { orgId } = await getActorFromHeaders();

    const tokens = await prisma.apiToken.findMany({
      where: { orgId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ tokens });
  } catch (err) {
    console.error("GET /api/tokens error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/tokens — create a new API token (returns raw token ONCE)
export async function POST(req: NextRequest) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    const body = await req.json();
    const name = (body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const scopes: string[] = Array.isArray(body.scopes) ? body.scopes : ["read", "route"];
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

    // Generate raw token: lr_ + 40 hex chars
    const rawToken = `lr_${crypto.randomBytes(20).toString("hex")}`;
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const prefix = rawToken.slice(0, 8); // "lr_xxxxx"

    const apiToken = await prisma.apiToken.create({
      data: {
        orgId,
        name,
        tokenHash,
        prefix,
        scopes,
        expiresAt,
      },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "API_TOKEN_CREATED",
        entityType: "ApiToken",
        entityId: apiToken.id,
        afterState: { name, prefix, scopes },
      },
    });

    return NextResponse.json(
      {
        token: rawToken, // shown ONCE — never stored/returned again
        id: apiToken.id,
        name: apiToken.name,
        prefix: apiToken.prefix,
        scopes: apiToken.scopes,
        expiresAt: apiToken.expiresAt,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error("POST /api/tokens error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
