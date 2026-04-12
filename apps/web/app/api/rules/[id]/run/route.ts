import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getActorFromHeaders } from "@/lib/auth";
import { buildSoqlFromCriteria, SearchCriterion } from "@/lib/build-soql";
import crypto from "crypto";

const SF_API_VERSION = "v59.0";

/** Standard fields to query from Salesforce so engine can evaluate rule conditions */
const SOQL_FIELDS: Record<string, string[]> = {
  Lead: [
    "Id", "OwnerId", "Name", "FirstName", "LastName", "Email", "Company",
    "Title", "Phone", "LeadSource", "Status", "Rating", "Industry",
    "AnnualRevenue", "NumberOfEmployees", "State", "Country", "City",
    "PostalCode", "Website", "Description", "CreatedDate", "LastModifiedDate",
  ],
  Contact: [
    "Id", "OwnerId", "Name", "FirstName", "LastName", "Email", "AccountId",
    "Title", "Phone", "LeadSource", "Department", "MailingState",
    "MailingCountry", "MailingCity", "CreatedDate", "LastModifiedDate",
  ],
  Account: [
    "Id", "OwnerId", "Name", "Industry", "AnnualRevenue", "NumberOfEmployees",
    "Type", "BillingState", "BillingCountry", "BillingCity", "Website",
    "Phone", "CreatedDate", "LastModifiedDate",
  ],
};

/** Max records per batch POST to engine (to stay within request size limits) */
const ENGINE_BATCH_SIZE = 200;

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

  // Fire-and-forget to engine — don't wait for routing to complete
  // The engine handles: Search vs Export API auto-scaling, bulk routing, batchUpdate
  const engineUrl = process.env.ENGINE_URL ?? "http://engine:3001";
  const internalToken = process.env.INTERNAL_API_KEY;

  console.log(`[run] Delegating HubSpot rule "${rule.name}" (${ruleId}) to engine (fire-and-forget)`);

  // Fire-and-forget: don't await — routing happens in the background
  fetch(`${engineUrl}/run-scheduled`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Org-Id": orgId,
      ...(internalToken ? { Authorization: `Bearer ${internalToken}` } : {}),
    },
    body: JSON.stringify({ ruleId }),
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

  // Return immediately — routing happens in the background
  return NextResponse.json({
    success: true,
    async: true,
    recordsFound: -1, // -1 signals "count pending — engine determining"
    recordsRouted: 0,
    durationMs,
    message: `Route started — records are being processed in the background`,
  });
}

// ─── Salesforce Search Route ──────────────────────────────────────────────────

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
  if (!org.sfdcOrgId) {
    return NextResponse.json(
      { error: "Organization not fully configured (missing sfdcOrgId)" },
      { status: 400 }
    );
  }

  // Map Prisma enum to SF object name
  const objectTypeMap: Record<string, string> = {
    LEAD: "Lead",
    CONTACT: "Contact",
    ACCOUNT: "Account",
  };
  const sfObjectType = objectTypeMap[rule.objectType] ?? "Lead";

  // Parse search criteria from JSON
  let criteria: SearchCriterion[] = [];
  if (rule.searchCriteria && Array.isArray(rule.searchCriteria)) {
    for (const group of rule.searchCriteria as any[]) {
      if (group.field && group.operator) {
        criteria.push({
          field: group.field,
          operator: group.operator,
          value: group.value ?? "",
        });
      } else if (group.fieldApiName && group.operator) {
        criteria.push({
          field: group.fieldApiName,
          operator: group.operator,
          value: group.value ?? "",
        });
      } else if (Array.isArray(group.conditions)) {
        for (const cond of group.conditions) {
          if (cond.field && cond.operator) {
            criteria.push({
              field: cond.field,
              operator: cond.operator,
              value: cond.value ?? "",
            });
          } else if (cond.fieldApiName && cond.operator) {
            criteria.push({
              field: cond.fieldApiName,
              operator: cond.operator,
              value: cond.value ?? "",
            });
          }
        }
      }
    }
  }

  // Build SOQL query
  const fields = SOQL_FIELDS[sfObjectType] ?? SOQL_FIELDS.Lead;
  const soql = buildSoqlFromCriteria(sfObjectType, criteria, fields);
  console.log(`[run] Rule "${rule.name}" (${rule.id}): executing SOQL → ${soql}`);

  // Query Salesforce
  const queryUrl = `${org.sfdcInstanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;
  const sfResponse = await fetch(queryUrl, {
    headers: {
      Authorization: `Bearer ${org.oauthAccessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!sfResponse.ok) {
    const errBody = await sfResponse.text();
    console.error(`[run] Salesforce query failed: ${sfResponse.status}`, errBody);

    const durationMs = Date.now() - startTime;
    await updateRuleStats(ruleId, 0, 0, durationMs, "FAILED");

    await prisma.auditLog.create({
      data: {
        orgId, actorId, actorName,
        action: "RULE_RUN_MANUALLY",
        entityType: "RoutingRule",
        entityId: ruleId,
        afterState: {
          ruleName: rule.name, routeType: rule.routeType, objectType: rule.objectType,
          status: "FAILED", error: `Salesforce query failed: ${sfResponse.status}`,
        },
      },
    });

    return NextResponse.json(
      { success: false, error: `Salesforce query failed (${sfResponse.status})`, details: errBody, durationMs },
      { status: 502 }
    );
  }

  const queryResult = await sfResponse.json();
  const sfRecords: any[] = queryResult.records ?? [];
  const recordsFound = queryResult.totalSize ?? sfRecords.length;

  console.log(`[run] Rule "${rule.name}": found ${recordsFound} records in ${Date.now() - startTime}ms`);

  if (recordsFound === 0) {
    const durationMs = Date.now() - startTime;
    await updateRuleStats(ruleId, 0, 0, durationMs, "SUCCESS");
    return NextResponse.json({
      success: true, recordsFound: 0, recordsRouted: 0, durationMs,
      message: "No matching records found",
    });
  }

  // Send records to engine
  const engineUrl = process.env.ENGINE_URL ?? "http://engine:3001";
  const timestamp = new Date().toISOString();
  let totalAccepted = 0;
  let totalDuplicates = 0;
  const batchIds: string[] = [];

  for (let i = 0; i < sfRecords.length; i += ENGINE_BATCH_SIZE) {
    const batch = sfRecords.slice(i, i + ENGINE_BATCH_SIZE);

    const batchPayload = {
      sfdcOrgId: org.sfdcOrgId,
      objectType: rule.objectType as "LEAD" | "CONTACT" | "ACCOUNT",
      eventType: "SEARCH" as const,
      ruleId: rule.id,
      timestamp,
      records: batch.map((rec: any) => {
        const { attributes, ...fields } = rec;
        return { recordId: rec.Id, fields };
      }),
    };

    const bodyStr = JSON.stringify(batchPayload);
    const hmac = crypto
      .createHmac("sha256", org.webhookSecret!)
      .update(bodyStr)
      .digest("hex");

    try {
      const engineRes = await fetch(`${engineUrl}/route/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature-256": `sha256=${hmac}`,
        },
        body: bodyStr,
      });

      if (!engineRes.ok) {
        const errText = await engineRes.text();
        console.error(`[run] Engine batch failed: ${engineRes.status}`, errText);
      } else {
        const result = await engineRes.json();
        totalAccepted += result.accepted ?? 0;
        totalDuplicates += result.duplicates ?? 0;
        if (result.batchId) batchIds.push(result.batchId);
      }
    } catch (engineErr) {
      console.error(`[run] Engine batch error:`, engineErr);
    }
  }

  const durationMs = Date.now() - startTime;

  await updateRuleStats(ruleId, totalAccepted, recordsFound, durationMs,
    totalAccepted > 0 ? "SUCCESS" : "PARTIAL");

  await prisma.auditLog.create({
    data: {
      orgId, actorId, actorName,
      action: "RULE_RUN_MANUALLY",
      entityType: "RoutingRule",
      entityId: ruleId,
      afterState: {
        ruleName: rule.name, routeType: rule.routeType, objectType: rule.objectType,
        totalRuns: (rule.totalRuns ?? 0) + 1,
        recordsFound, recordsAccepted: totalAccepted, recordsDuplicate: totalDuplicates,
        durationMs, batchIds, soql,
      },
    },
  });

  return NextResponse.json({
    success: true,
    recordsFound,
    recordsRouted: totalAccepted,
    recordsDuplicate: totalDuplicates,
    durationMs,
    message: totalAccepted > 0
      ? `Route executed — ${totalAccepted} records sent for routing`
      : `${recordsFound} records found but none accepted for routing`,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function updateRuleStats(
  ruleId: string,
  recordsRouted: number,
  recordsFound: number,
  durationMs: number,
  status: string,
) {
  await prisma.routingRule.update({
    where: { id: ruleId },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: status,
      lastRunRecords: recordsRouted,
      lastRunDurationMs: durationMs,
      totalRuns: { increment: 1 },
      totalRecordsRouted: { increment: recordsRouted },
    },
  });
}
