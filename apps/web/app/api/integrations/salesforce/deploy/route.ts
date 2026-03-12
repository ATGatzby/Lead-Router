import { NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { SalesforceApi, DuplicateError, zipSourcePackage } from "@lead-routing/sfdc";
import { existsSync, readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function patchXml(content: string, tag: string, value: string): string {
  const re = new RegExp(`(<${tag}>)[^<]*(</\\s*${tag}>)`, "g");
  return content.replace(re, `$1${value}$2`);
}

/**
 * POST /api/integrations/salesforce/deploy
 *
 * Deploys the Salesforce managed package to the connected org.
 * Patches Named Credential, Remote Site Settings, assigns permission set,
 * and writes Routing_Settings__c.
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

    // ── 1. Locate bundled sfdc-package ──────────────────────────────────────
    // In Docker: WORKDIR=/app, sfdc-package at /app/sfdc-package
    // Next.js standalone may change cwd to /app/apps/web, so check multiple paths
    const candidates = [
      "/app/sfdc-package",                                   // Docker absolute
      join(process.cwd(), "sfdc-package"),                   // relative to cwd
      join(process.cwd(), "..", "..", "sfdc-package"),        // up from apps/web
      join(process.cwd(), "apps", "cli", "sfdc-package"),    // dev: repo root
    ];
    const bundledPkg = candidates.find((p) => existsSync(p)) ?? null;

    if (!bundledPkg) {
      return NextResponse.json(
        { error: "sfdc-package not found. Checked: " + candidates.join(", ") },
        { status: 500 }
      );
    }

    // ── 2. Copy to temp dir and patch XML files ────────────────────────────
    const destPkg = join(tmpdir(), `lead-routing-sfdc-package-${orgId}`);
    if (existsSync(destPkg)) rmSync(destPkg, { recursive: true, force: true });
    cpSync(bundledPkg, destPkg, { recursive: true });

    // Patch Named Credential
    const ncPath = join(
      destPkg,
      "force-app", "main", "default", "namedCredentials",
      "RoutingEngine.namedCredential-meta.xml"
    );
    if (existsSync(ncPath)) {
      const nc = patchXml(readFileSync(ncPath, "utf8"), "endpoint", engineUrl);
      writeFileSync(ncPath, nc, "utf8");
    }

    // Patch Remote Site Settings — Engine
    const rssEnginePath = join(
      destPkg,
      "force-app", "main", "default", "remoteSiteSettings",
      "LeadRouterEngine.remoteSite-meta.xml"
    );
    if (existsSync(rssEnginePath)) {
      let rss = patchXml(readFileSync(rssEnginePath, "utf8"), "url", engineUrl);
      rss = patchXml(rss, "description", "Lead Router Engine endpoint");
      writeFileSync(rssEnginePath, rss, "utf8");
    }

    // Patch Remote Site Settings — App
    const rssAppPath = join(
      destPkg,
      "force-app", "main", "default", "remoteSiteSettings",
      "LeadRouterApp.remoteSite-meta.xml"
    );
    if (existsSync(rssAppPath)) {
      let rss = patchXml(readFileSync(rssAppPath, "utf8"), "url", appUrl);
      rss = patchXml(rss, "description", "Lead Router App URL");
      writeFileSync(rssAppPath, rss, "utf8");
    }

    // ── 3. ZIP and deploy ──────────────────────────────────────────────────
    const zipBuffer = await zipSourcePackage(destPkg);
    const deployId = await sf.deployMetadata(zipBuffer);
    const result = await sf.waitForDeploy(deployId);

    // Log full deploy result for diagnostics
    console.log("[sfdc-deploy] Deploy result:", JSON.stringify({
      success: result.success,
      status: result.status,
      numberComponentsDeployed: result.numberComponentsDeployed,
      numberComponentErrors: result.numberComponentErrors,
      numberComponentsTotal: result.numberComponentsTotal,
    }));
    if ((result.details as any)?.componentSuccesses) {
      const successes = Array.isArray((result.details as any).componentSuccesses)
        ? (result.details as any).componentSuccesses
        : [(result.details as any).componentSuccesses];
      console.log("[sfdc-deploy] Deployed components:", successes.map((c: any) => `${c.componentType}/${c.fullName}`).join(", "));
    }

    if (!result.success) {
      const failures = (result.details as any)?.componentFailures ?? [];
      const failureMsg = (Array.isArray(failures) ? failures : [failures])
        .map((f: any) => `${f.componentType}/${f.fullName}: ${f.problem}`)
        .join("; ");
      console.error("[sfdc-deploy] Metadata deploy failed:", failureMsg || result.errorMessage);
      console.error("[sfdc-deploy] Full deploy result:", JSON.stringify(result, null, 2));
      return NextResponse.json(
        {
          error: "Metadata deploy failed",
          details: failureMsg || result.errorMessage || "Unknown error",
          componentErrors: result.numberComponentErrors,
        },
        { status: 422 }
      );
    }

    // ── 4. Assign LeadRouterAdmin permission set ───────────────────────────
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

    // ── 5. Write Routing_Settings__c ───────────────────────────────────────
    let settingsWritten = false;
    try {
      const existing = await sf.query<{ Id: string }>(
        "SELECT Id FROM Routing_Settings__c LIMIT 1"
      );

      const settingsData: Record<string, string> = {
        App_Url__c: appUrl,
        Engine_Endpoint__c: engineUrl,
      };
      if (org.webhookSecret) {
        settingsData.Webhook_Secret__c = org.webhookSecret;
      }

      if (existing.length > 0) {
        await sf.update("Routing_Settings__c", existing[0].Id, settingsData);
      } else {
        await sf.create("Routing_Settings__c", settingsData);
      }
      settingsWritten = true;
    } catch (err) {
      console.error("[sfdc-deploy] Routing_Settings__c write failed:", err);
    }

    // ── 6. Update org record ───────────────────────────────────────────────
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        packageDeployedAt: new Date(),
        packageDeployId: deployId,
        packageVersion: "1.0.0",
      },
    });

    // Clean up temp dir
    try {
      rmSync(destPkg, { recursive: true, force: true });
    } catch {
      // non-critical
    }

    return NextResponse.json({
      success: true,
      componentsDeployed: result.numberComponentsDeployed,
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
