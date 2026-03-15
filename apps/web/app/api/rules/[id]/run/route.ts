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

    // 2. Look up the organization for Salesforce credentials + engine auth
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        sfdcInstanceUrl: true,
        sfdcOrgId: true,
        oauthAccessToken: true,
        oauthRefreshToken: true,
        webhookSecret: true,
      },
    });

    if (!org?.oauthAccessToken || !org.sfdcInstanceUrl) {
      return NextResponse.json(
        { error: "Salesforce not connected" },
        { status: 400 }
      );
    }

    if (!org.sfdcOrgId || !org.webhookSecret) {
      return NextResponse.json(
        { error: "Organization not fully configured (missing sfdcOrgId or webhookSecret)" },
        { status: 400 }
      );
    }

    // 3. Map Prisma enum to SF object name
    const objectTypeMap: Record<string, string> = {
      LEAD: "Lead",
      CONTACT: "Contact",
      ACCOUNT: "Account",
    };
    const sfObjectType = objectTypeMap[rule.objectType] ?? "Lead";

    // 4. Parse search criteria from JSON
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
          // Nested condition format: { fieldApiName, operator, value }
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

    // 5. Build SOQL query with comprehensive field list for engine evaluation
    const fields = SOQL_FIELDS[sfObjectType] ?? SOQL_FIELDS.Lead;
    const soql = buildSoqlFromCriteria(sfObjectType, criteria, fields);
    console.log(
      `[run] Rule "${rule.name}" (${rule.id}): executing SOQL → ${soql}`
    );

    // 6. Query Salesforce
    const queryUrl = `${org.sfdcInstanceUrl}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(soql)}`;
    console.log(`[run] Salesforce query URL: ${queryUrl}`);

    const sfResponse = await fetch(queryUrl, {
      headers: {
        Authorization: `Bearer ${org.oauthAccessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!sfResponse.ok) {
      const errBody = await sfResponse.text();
      console.error(
        `[run] Salesforce query failed: ${sfResponse.status} ${sfResponse.statusText}`,
        errBody
      );

      const durationMs = Date.now() - startTime;

      await prisma.routingRule.update({
        where: { id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: "FAILED",
          lastRunRecords: 0,
          lastRunDurationMs: durationMs,
          totalRuns: { increment: 1 },
        },
      });

      await prisma.auditLog.create({
        data: {
          orgId,
          actorId,
          actorName,
          action: "RULE_RUN_MANUALLY",
          entityType: "RoutingRule",
          entityId: id,
          afterState: {
            ruleName: rule.name,
            routeType: rule.routeType,
            objectType: rule.objectType,
            status: "FAILED",
            error: `Salesforce query failed: ${sfResponse.status}`,
          },
        },
      });

      return NextResponse.json(
        {
          success: false,
          error: `Salesforce query failed (${sfResponse.status})`,
          details: errBody,
          durationMs,
        },
        { status: 502 }
      );
    }

    const queryResult = await sfResponse.json();
    const sfRecords: any[] = queryResult.records ?? [];
    const recordsFound = queryResult.totalSize ?? sfRecords.length;

    console.log(
      `[run] Rule "${rule.name}": found ${recordsFound} records in ${Date.now() - startTime}ms`
    );

    if (recordsFound === 0) {
      const durationMs = Date.now() - startTime;
      await prisma.routingRule.update({
        where: { id },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: "SUCCESS",
          lastRunRecords: 0,
          lastRunDurationMs: durationMs,
          totalRuns: { increment: 1 },
        },
      });

      return NextResponse.json({
        success: true,
        recordsFound: 0,
        recordsRouted: 0,
        durationMs,
        message: "No matching records found",
      });
    }

    // 7. Send records to engine for actual routing via /route/batch
    const engineUrl = process.env.ENGINE_URL ?? "http://engine:3001";
    const timestamp = new Date().toISOString();
    let totalAccepted = 0;
    let totalDuplicates = 0;
    const batchIds: string[] = [];

    // Process in batches of ENGINE_BATCH_SIZE
    for (let i = 0; i < sfRecords.length; i += ENGINE_BATCH_SIZE) {
      const batch = sfRecords.slice(i, i + ENGINE_BATCH_SIZE);

      const batchPayload = {
        sfdcOrgId: org.sfdcOrgId,
        objectType: rule.objectType as "LEAD" | "CONTACT" | "ACCOUNT",
        eventType: "SEARCH" as const, // SEARCH events only match SCHEDULED rules in the engine
        ruleId: rule.id, // Target this specific rule only
        timestamp,
        records: batch.map((rec: any) => {
          // Strip Salesforce metadata (attributes) and extract clean fields
          const { attributes, ...fields } = rec;
          return {
            recordId: rec.Id,
            fields,
          };
        }),
      };

      const bodyStr = JSON.stringify(batchPayload);

      // Sign with HMAC-SHA256 (same format engine expects)
      const hmac = crypto
        .createHmac("sha256", org.webhookSecret)
        .update(bodyStr)
        .digest("hex");

      console.log(
        `[run] Sending batch ${Math.floor(i / ENGINE_BATCH_SIZE) + 1} (${batch.length} records) to engine`
      );

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
          console.error(
            `[run] Engine batch failed: ${engineRes.status}`,
            errText
          );
        } else {
          const result = await engineRes.json();
          console.log(`[run] Engine batch result:`, result);
          totalAccepted += result.accepted ?? 0;
          totalDuplicates += result.duplicates ?? 0;
          if (result.batchId) batchIds.push(result.batchId);
        }
      } catch (engineErr) {
        console.error(`[run] Engine batch error:`, engineErr);
      }
    }

    const durationMs = Date.now() - startTime;

    console.log(
      `[run] Rule "${rule.name}" complete: ${totalAccepted} accepted, ${totalDuplicates} duplicates, ${durationMs}ms`
    );

    // 8. Update rule with run results
    const updated = await prisma.routingRule.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: totalAccepted > 0 ? "SUCCESS" : "PARTIAL",
        lastRunRecords: totalAccepted,
        lastRunDurationMs: durationMs,
        totalRuns: { increment: 1 },
        totalRecordsRouted: { increment: totalAccepted },
      },
    });

    // 9. Audit log
    await prisma.auditLog.create({
      data: {
        orgId,
        actorId,
        actorName,
        action: "RULE_RUN_MANUALLY",
        entityType: "RoutingRule",
        entityId: id,
        afterState: {
          ruleName: rule.name,
          routeType: rule.routeType,
          objectType: rule.objectType,
          totalRuns: updated.totalRuns,
          recordsFound,
          recordsAccepted: totalAccepted,
          recordsDuplicate: totalDuplicates,
          durationMs,
          batchIds,
          soql,
        },
      },
    });

    // 10. Return result
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
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("POST /api/rules/:id/run error:", err);
    return NextResponse.json(
      { error: "Internal server error", durationMs },
      { status: 500 }
    );
  }
}
