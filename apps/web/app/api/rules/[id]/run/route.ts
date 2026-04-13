import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";

// POST /api/rules/:id/run — manually run a scheduled route
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now();

  try {
    const { id } = await params;
    const actor = await getActorFromHeaders();
    const { orgId, userId: actorId, userName: actorName } = actor;

    // 1. Look up the full rule including searchCriteria and objectType
    const rule = await prisma.routingRule.findFirst({
      where: { id, orgId },
      select: {
        id: true,
        name: true,
        routeType: true,
        objectType: true,
        searchCriteria: true,
        totalRuns: true,
        totalRecordsRouted: true,
      },
    });

    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    // 2. Look up the organization for CRM credentials + engine auth
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        crmType: true,
        sfdcInstanceUrl: true,
        sfdcOrgId: true,
        hubspotPortalId: true,
        oauthAccessToken: true,
        oauthRefreshToken: true,
        webhookSecret: true,
      },
    });

    if (!org?.oauthAccessToken) {
      return NextResponse.json(
        { error: "CRM not connected" },
        { status: 400 }
      );
    }

    if (!org.webhookSecret) {
      return NextResponse.json(
        { error: "Organization not fully configured (missing webhookSecret)" },
        { status: 400 }
      );
    }

    const isHubSpot = org.crmType === "HUBSPOT";

    // Route to CRM-specific handler
    if (isHubSpot) {
      return await runHubSpotRoute(rule, org, orgId, actorId, actorName, id, startTime);
    } else {
      return await runSalesforceRoute(rule, org, orgId, actorId, actorName, id, startTime);
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("POST /api/rules/:id/run error:", err);
    return NextResponse.json(
      { error: message, durationMs },
      { status: 500 }
    );
  }
}

// ─── HubSpot Search Route ─────────────────────────────────────────────────────
// Delegates to the engine's /run-scheduled endpoint which handles:
// - Token refresh (via hubspot-connection.ts)
// - Search vs Export API auto-scaling (>10K → Export API)
// - Bulk routing with batchUpdate error tracking
// - Field name mapping (CSV display names → API names)

async function runHubSpotRoute(
  rule: any,
  org: any,
  orgId: string,
  actorId: string,
  actorName: string,
  ruleId: string,
  startTime: number,
) {
  if (!org.hubspotPortalId) {
    return NextResponse.json({ error: "HubSpot not connected" }, { status: 400 });
  }

  // Refresh OAuth token before delegating to engine (engine uses cached client)
  const { refreshAccessToken } = await import("@lead-routing/hubspot");
  if (org.oauthRefreshToken && process.env.HUBSPOT_CLIENT_ID && process.env.HUBSPOT_CLIENT_SECRET) {
    try {
      const tokens = await refreshAccessToken(
        process.env.HUBSPOT_CLIENT_ID,
        process.env.HUBSPOT_CLIENT_SECRET,
        org.oauthRefreshToken,
      );
      await prisma.organization.update({
        where: { id: orgId },
        data: {
          oauthAccessToken: tokens.access_token,
          oauthRefreshToken: tokens.refresh_token,
        },
      });
      console.log(`[run] HubSpot OAuth token refreshed for org ${orgId}`);
    } catch (refreshErr) {
      console.error(`[run] HubSpot token refresh failed:`, refreshErr);
    }
  }

  // Create a bulk search run so the UI can poll for progress
  const bulkRun = await prisma.bulkSearchRun.create({
    data: { orgId, ruleId },
  });

  // Fire-and-forget to engine — don't wait for routing to complete
  // The engine handles: Search vs Export API auto-scaling, bulk routing, batchUpdate
  const engineUrl = process.env.ENGINE_URL ?? "http://engine:3001";
  const internalToken = process.env.INTERNAL_API_KEY;

  console.log(`[run] Delegating HubSpot rule "${rule.name}" (${ruleId}) to engine (fire-and-forget, runId: ${bulkRun.id})`);

  // Fire-and-forget: don't await — routing happens in the background
  fetch(`${engineUrl}/run-scheduled`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Org-Id": orgId,
      ...(internalToken ? { Authorization: `Bearer ${internalToken}` } : {}),
    },
    body: JSON.stringify({ ruleId, runId: bulkRun.id }),
  }).catch((err) => {
    console.error(`[run] Engine run-scheduled fire-and-forget error:`, err);
  });

  const durationMs = Date.now() - startTime;

  await prisma.auditLog.create({
    data: {
      orgId,
      actorId,
      actorName,
      action: "RULE_RUN_MANUALLY",
      entityType: "RoutingRule",
      entityId: ruleId,
      afterState: {
        ruleName: rule.name,
        routeType: rule.routeType,
        objectType: rule.objectType,
        durationMs,
        crm: "hubspot",
      },
    },
  });

  // Return immediately with bulkRunId — UI polls /api/bulk-run/{id}/status
  return NextResponse.json({
    success: true,
    async: true,
    bulkRunId: bulkRun.id,
    recordsFound: -1,
    recordsRouted: 0,
    durationMs,
    message: `Route started — records are being processed in the background`,
  });
}

// ─── Salesforce Search Route ──────────────────────────────────────────────────
// Delegates to engine's /run-scheduled endpoint (same pattern as HubSpot)

async function runSalesforceRoute(
  rule: any,
  org: any,
  orgId: string,
  actorId: string,
  actorName: string,
  ruleId: string,
  startTime: number,
) {
  if (!org.sfdcInstanceUrl) {
    return NextResponse.json({ error: "Salesforce not connected" }, { status: 400 });
  }

  // Create a bulk search run so the UI can poll for progress
  const bulkRun = await prisma.bulkSearchRun.create({
    data: { orgId, ruleId },
  });

  const engineUrl = process.env.ENGINE_URL ?? "http://engine:3001";
  const internalToken = process.env.INTERNAL_API_KEY;

  console.log(`[run] Delegating SFDC rule "${rule.name}" (${ruleId}) to engine (fire-and-forget, runId: ${bulkRun.id})`);

  // Fire-and-forget: don't await — routing happens in the engine
  fetch(`${engineUrl}/run-scheduled`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Org-Id": orgId,
      ...(internalToken ? { Authorization: `Bearer ${internalToken}` } : {}),
    },
    body: JSON.stringify({ ruleId, runId: bulkRun.id }),
  }).catch((err) => {
    console.error(`[run] Engine run-scheduled fire-and-forget error:`, err);
  });

  const durationMs = Date.now() - startTime;

  await prisma.auditLog.create({
    data: {
      orgId, actorId, actorName,
      action: "RULE_RUN_MANUALLY",
      entityType: "RoutingRule",
      entityId: ruleId,
      afterState: {
        ruleName: rule.name, routeType: rule.routeType, objectType: rule.objectType,
        durationMs, crm: "salesforce",
      },
    },
  });

  return NextResponse.json({
    success: true,
    async: true,
    bulkRunId: bulkRun.id,
    recordsFound: -1,
    recordsRouted: 0,
    durationMs,
    message: `Route started — records are being processed in the background`,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

