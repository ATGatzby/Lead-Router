import { NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { SalesforceApi, DuplicateError, zipSourcePackage } from "@lead-routing/sfdc";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

/**
 * Build Remote Site Setting XML for Metadata API deployment.
 */
function remoteSiteXml(fullName: string, url: string, description: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<RemoteSiteSetting xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>${description}</description>
    <disableProtocolSecurity>false</disableProtocolSecurity>
    <isActive>true</isActive>
    <url>${url}</url>
</RemoteSiteSetting>`;
}

/**
 * POST /api/integrations/salesforce/deploy
 *
 * Configures the customer's Salesforce org after the managed package is installed.
 * Deploys Remote Site Settings (patched with customer URLs), assigns the
 * LeadRouterAdmin permission set, and writes lrt__Routing_Settings__c.
 */
export async function POST() {
  try {
    const orgId = await getOrgIdFromHeaders();

    // Fetch org with SFDC tokens
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        sfdcInstanceUrl: true,
        oauthAccessToken: true,
        oauthRefreshToken: true,
        webhookSecret: true,
      },
    });

    if (!org) {
      return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    }

    if (!org.oauthAccessToken || !org.sfdcInstanceUrl) {
      return NextResponse.json(
        { error: "Salesforce is not connected. Complete OAuth first." },
        { status: 400 }
      );
    }

    const sf = new SalesforceApi(org.sfdcInstanceUrl, org.oauthAccessToken);

    const engineUrl =
      process.env.PUBLIC_ENGINE_URL ?? process.env.ENGINE_URL ?? "http://localhost:3001";
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";

    // ── 1. Deploy/update Remote Site Settings via Metadata API ──────────────
    // The managed package is already installed; we only need to deploy
    // Remote Site Settings patched with the customer's engine and app URLs.
    let remoteSitesDeployed = false;
    const destPkg = join(tmpdir(), `lead-routing-rss-${orgId}`);
    try {
      // Build a minimal source-format package with just Remote Site Settings
      const rssDir = join(destPkg, "force-app", "main", "default", "remoteSiteSettings");
      mkdirSync(rssDir, { recursive: true });

      writeFileSync(
        join(rssDir, "LeadRouterEngine.remoteSite-meta.xml"),
        remoteSiteXml("LeadRouterEngine", engineUrl, "Lead Router Engine endpoint"),
        "utf8"
      );
      writeFileSync(
        join(rssDir, "LeadRouterApp.remoteSite-meta.xml"),
        remoteSiteXml("LeadRouterApp", appUrl, "Lead Router App URL"),
        "utf8"
      );

      const zipBuffer = await zipSourcePackage(destPkg);
      const deployId = await sf.deployMetadata(zipBuffer);
      const result = await sf.waitForDeploy(deployId);

      console.log("[sfdc-deploy] Remote Site Settings deploy result:", JSON.stringify({
        success: result.success,
        status: result.status,
        numberComponentsDeployed: result.numberComponentsDeployed,
        numberComponentErrors: result.numberComponentErrors,
      }));

      if (!result.success) {
        const failures = (result.details as any)?.componentFailures ?? [];
        const failureMsg = (Array.isArray(failures) ? failures : [failures])
          .map((f: any) => `${f.componentType}/${f.fullName}: ${f.problem}`)
          .join("; ");
        console.error("[sfdc-deploy] Remote Site Settings deploy failed:", failureMsg || result.errorMessage);
      } else {
        remoteSitesDeployed = true;
      }
    } catch (err) {
      console.error("[sfdc-deploy] Remote Site Settings deploy error:", err);
    } finally {
      try {
        rmSync(destPkg, { recursive: true, force: true });
      } catch {
        // non-critical
      }
    }

    // ── 2. Assign LeadRouterAdmin permission set ───────────────────────────
    let permSetAssigned = false;
    try {
      const permSets = await sf.query<{ Id: string }>(
        "SELECT Id FROM PermissionSet WHERE Name = 'LeadRouterAdmin' LIMIT 1"
      );
      if (permSets.length > 0) {
        const userId = await sf.getCurrentUserId();
        try {
          await sf.create("PermissionSetAssignment", {
            AssigneeId: userId,
            PermissionSetId: permSets[0].Id,
          });
          permSetAssigned = true;
        } catch (err) {
          if (err instanceof DuplicateError) {
            permSetAssigned = true; // already assigned
          } else {
            console.error("[sfdc-deploy] Permission set assignment failed:", err);
          }
        }
      }
    } catch (err) {
      console.error("[sfdc-deploy] Permission set lookup failed:", err);
    }

    // ── 3. Write lrt__Routing_Settings__c ──────────────────────────────────
    let settingsWritten = false;
    try {
      const existing = await sf.query<{ Id: string }>(
        "SELECT Id FROM lrt__Routing_Settings__c LIMIT 1"
      );

      const settingsData: Record<string, string> = {
        lrt__App_Url__c: appUrl,
        lrt__Engine_Endpoint__c: engineUrl,
      };
      if (org.webhookSecret) {
        settingsData.lrt__Webhook_Secret__c = org.webhookSecret;
      }

      if (existing.length > 0) {
        await sf.update("lrt__Routing_Settings__c", existing[0].Id, settingsData);
      } else {
        await sf.create("lrt__Routing_Settings__c", settingsData);
      }
      settingsWritten = true;
    } catch (err) {
      console.error("[sfdc-deploy] lrt__Routing_Settings__c write failed:", err);
    }

    // ── 4. Update org record ───────────────────────────────────────────────
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        packageDeployedAt: new Date(),
        packageVersion: "1.0.0",
      },
    });

    return NextResponse.json({
      success: true,
      remoteSitesDeployed,
      permSetAssigned,
      settingsWritten,
    });
  } catch (err) {
    console.error("POST /api/integrations/salesforce/deploy error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
