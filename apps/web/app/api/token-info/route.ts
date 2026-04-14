import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

/**
 * GET /api/token-info
 *
 * Returns everything an MCP server needs to auto-configure itself.
 * Requires a valid Bearer token. Called once on MCP startup, result cached.
 */
export async function GET() {
  try {
    const { orgId } = await getActorFromHeaders();

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        crmType: true,
        sfdcOrgId: true,
        hubspotPortalId: true,
        webhookSecret: true,
      },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    const crmType = org.crmType || "SALESFORCE";
    const crmOrgId = crmType === "HUBSPOT" ? org.hubspotPortalId : org.sfdcOrgId;

    // Extract token metadata from proxy-injected headers
    const hdrs = await headers();
    const userId = hdrs.get("x-user-id") || "";
    let tokenId: string | null = null;
    let scopes: string[] | null = null;
    let expiresAt: string | null = null;

    if (userId.startsWith("api-token:")) {
      tokenId = userId.replace("api-token:", "");
      const token = await prisma.apiToken.findUnique({
        where: { id: tokenId },
        select: { id: true, scopes: true, expiresAt: true },
      });
      if (token) {
        scopes = token.scopes as string[];
        expiresAt = token.expiresAt ? token.expiresAt.toISOString() : null;
      }
    }

    return NextResponse.json({
      engineUrl: process.env.PUBLIC_ENGINE_URL || process.env.ENGINE_URL,
      crmType,
      crmOrgId: crmOrgId || "",
      tokenId,
      scopes,
      expiresAt,
    });
  } catch {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }
}
