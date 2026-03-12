import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { SalesforceApi } from "@lead-routing/sfdc";

const API_VERSION = "v59.0";

/**
 * POST /api/rules/:id/sync-criteria
 * Syncs trigger conditions from the database to Salesforce as Route_Criteria__c records.
 * Called automatically after rule save when SFDC is connected.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: ruleId } = await params;
    const orgId = await getOrgIdFromHeaders();

    // Load rule with trigger conditions
    const rule = await prisma.routingRule.findFirst({
      where: { id: ruleId, orgId },
      include: { triggerConditions: { orderBy: { sortOrder: "asc" } } },
    });

    if (!rule) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }

    // Load org with SFDC credentials
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        sfdcOrgId: true,
        sfdcInstanceUrl: true,
        oauthAccessToken: true,
        oauthRefreshToken: true,
      },
    });

    if (!org?.sfdcOrgId || !org.oauthAccessToken || !org.sfdcInstanceUrl) {
      return NextResponse.json({ error: "Salesforce not connected" }, { status: 400 });
    }

    const sfApi = new SalesforceApi(org.sfdcInstanceUrl, org.oauthAccessToken);

    // Step 0: Verify Route_Criteria__c fields exist via describe
    const describeUrl = `${org.sfdcInstanceUrl}/services/data/${API_VERSION}/sobjects/Route_Criteria__c/describe/`;
    const describeRes = await fetch(describeUrl, {
      headers: { Authorization: `Bearer ${org.oauthAccessToken}` },
    });
    if (!describeRes.ok) {
      const descErr = await describeRes.text();
      console.error("[sync-criteria] Route_Criteria__c describe failed:", describeRes.status, descErr);
      return NextResponse.json(
        { error: "Route_Criteria__c not found in Salesforce. Please redeploy the package.", details: descErr },
        { status: 422 }
      );
    }
    const describeData = await describeRes.json() as { fields: Array<{ name: string }> };
    const fieldNames = describeData.fields.map((f: { name: string }) => f.name);
    console.log("[sync-criteria] Route_Criteria__c fields:", fieldNames.join(", "));

    const requiredFields = ["Rule_Id__c", "Object_Type__c", "Event_Type__c", "Group_Id__c", "Field_Name__c", "Operator__c", "Value__c", "Is_Active__c"];
    const missingFields = requiredFields.filter(f => !fieldNames.includes(f));
    if (missingFields.length > 0) {
      console.error("[sync-criteria] Missing fields on Route_Criteria__c:", missingFields.join(", "));
      return NextResponse.json(
        { error: `Route_Criteria__c is missing fields: ${missingFields.join(", ")}. Please redeploy the package.` },
        { status: 422 }
      );
    }

    // Step 1: Delete all existing Route_Criteria__c for this rule
    const existing = await sfApi.query<{ Id: string }>(
      `SELECT Id FROM Route_Criteria__c WHERE Rule_Id__c = '${ruleId}'`
    );

    if (existing.length > 0) {
      // Use composite API to delete in batches of 25
      for (let i = 0; i < existing.length; i += 25) {
        const batch = existing.slice(i, i + 25);
        await sfApi.composite(
          batch.map((rec, idx) => ({
            method: "DELETE" as const,
            url: `/services/data/${API_VERSION}/sobjects/Route_Criteria__c/${rec.Id}`,
            referenceId: `delete_${i + idx}`,
          }))
        );
      }
    }

    // Step 2: Create new Route_Criteria__c records from current trigger conditions
    const conditions = rule.triggerConditions;
    if (conditions.length > 0) {
      const objectType = rule.objectType; // LEAD, CONTACT, ACCOUNT
      const eventType = rule.triggerEvent; // INSERT, UPDATE, BOTH
      const isActive = rule.status === "ACTIVE";

      for (let i = 0; i < conditions.length; i += 25) {
        const batch = conditions.slice(i, i + 25);
        await sfApi.composite(
          batch.map((cond, idx) => ({
            method: "POST" as const,
            url: `/services/data/${API_VERSION}/sobjects/Route_Criteria__c`,
            referenceId: `create_${i + idx}`,
            body: {
              Rule_Id__c: ruleId,
              Object_Type__c: objectType,
              Event_Type__c: eventType,
              Group_Id__c: cond.groupId,
              Field_Name__c: cond.fieldName,
              Operator__c: cond.operator,
              Value__c: cond.value,
              Sort_Order__c: cond.sortOrder,
              Is_Active__c: isActive,
            },
          }))
        );
      }
    }

    // Step 3: Update criteriaSyncedAt
    await prisma.routingRule.update({
      where: { id: ruleId },
      data: { criteriaSyncedAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      deleted: existing.length,
      created: conditions.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("POST /api/rules/:id/sync-criteria error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
