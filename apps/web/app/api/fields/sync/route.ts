import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@lead-routing/db";
import { createConnection, syncFieldSchema } from "@lead-routing/sfdc";
import { validateSfdcHmac } from "@/lib/validate-sfdc-hmac";
import { getTierLimits, upgradeRequiredResponse } from "@/lib/license";
import { resolveBearerOrgId } from "@/lib/bearer-auth";

// POST /api/fields/sync?object=LEAD — trigger SFDC describeSObject sync
//
// Authentication (two paths):
//   1. Apex callout flow — sends `X-Sfdc-Org-Id` header. Used by the LWC
//      onboarding wizard via OnboardingController. HMAC-signed if available.
//   2. CLI / Bearer flow — sends `Authorization: Bearer lr_...`. This route
//      lives under a PUBLIC_PREFIX in proxy.ts, so the proxy does NOT inject
//      `x-org-id`; we resolve the token here via `resolveBearerOrgId()`.
export async function POST(req: NextRequest) {
  try {
    const hdrs = await headers();
    const headerSfdcOrgId = hdrs.get("x-sfdc-org-id");
    const authHeader = hdrs.get("authorization");
    const bearerOrgId = await resolveBearerOrgId(authHeader);

    if (!headerSfdcOrgId && !bearerOrgId) {
      return NextResponse.json(
        { error: "Missing X-Sfdc-Org-Id header or Bearer token" },
        { status: 401 }
      );
    }

    // Read body up-front so HMAC validation has the raw bytes.
    const body = await req.text();

    // ── Resolve org via either Apex header OR Bearer token ───────────────
    let org: {
      id: string;
      oauthAccessToken: string | null;
      oauthRefreshToken: string | null;
      sfdcInstanceUrl: string | null;
    } | null = null;
    let resolvedSfdcOrgId: string | null = null;

    if (headerSfdcOrgId) {
      // Apex callout path: identify org by sfdcOrgId, validate HMAC if signed.
      const signature = hdrs.get("x-signature-256");
      if (signature) {
        const valid = await validateSfdcHmac(headerSfdcOrgId, body, signature);
        if (!valid) {
          return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
        }
      }

      org = await prisma.organization.findUnique({
        where: { sfdcOrgId: headerSfdcOrgId },
        select: {
          id: true,
          oauthAccessToken: true,
          oauthRefreshToken: true,
          sfdcInstanceUrl: true,
        },
      });
      resolvedSfdcOrgId = headerSfdcOrgId;
    } else if (bearerOrgId) {
      // Bearer token path: org is already resolved by the API token lookup.
      const row = await prisma.organization.findUnique({
        where: { id: bearerOrgId },
        select: {
          id: true,
          sfdcOrgId: true,
          oauthAccessToken: true,
          oauthRefreshToken: true,
          sfdcInstanceUrl: true,
        },
      });
      if (row) {
        resolvedSfdcOrgId = row.sfdcOrgId;
        org = {
          id: row.id,
          oauthAccessToken: row.oauthAccessToken,
          oauthRefreshToken: row.oauthRefreshToken,
          sfdcInstanceUrl: row.sfdcInstanceUrl,
        };
      }
    }

    if (!org) {
      return NextResponse.json({ error: "Org not found" }, { status: 404 });
    }
    const orgId = org.id;

    const objectParam =
      req.nextUrl.searchParams.get("object")?.toUpperCase() ?? "LEAD";

    if (!["LEAD", "CONTACT", "ACCOUNT", "USER"].includes(objectParam)) {
      return NextResponse.json({ error: "Invalid object type" }, { status: 400 });
    }

    // USER object sync is always allowed (used for license-by-custom-field)
    if (objectParam !== "USER") {
      const limits = getTierLimits();
      if (!limits.allowedTriggers.includes(objectParam)) {
        return upgradeRequiredResponse(`${objectParam} object syncing`);
      }
    }

    const objectType = (objectParam.charAt(0) + objectParam.slice(1).toLowerCase()) as
      | "Lead"
      | "Contact"
      | "Account"
      | "User";

    if (!org.oauthAccessToken || !org.oauthRefreshToken || !org.sfdcInstanceUrl) {
      console.error(
        `[fields/sync] Salesforce not connected for org=${orgId} (sfdcOrgId=${resolvedSfdcOrgId ?? "none"})`
      );
      return NextResponse.json(
        { error: "Salesforce org not connected" },
        { status: 400 }
      );
    }

    const conn = createConnection({
      accessToken: org.oauthAccessToken,
      refreshToken: org.oauthRefreshToken,
      instanceUrl: org.sfdcInstanceUrl,
    });

    const count = await syncFieldSchema(conn, orgId, objectType);

    console.log(
      `[fields/sync] orgId=${orgId} object=${objectParam} synced=${count} via=${headerSfdcOrgId ? "apex" : "bearer"}`
    );

    return NextResponse.json({
      synced: count,
      objectType: objectParam,
      syncedAt: new Date(),
    });
  } catch (err) {
    console.error("POST /api/fields/sync error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
