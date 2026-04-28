import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@lead-routing/db";
import { resolveBearerOrgId } from "@/lib/bearer-auth";

/**
 * POST /api/setup/test-event
 *
 * CLI-callable endpoint that fires a synthetic Lead-routing event at the
 * engine to confirm end-to-end connectivity (web → engine → DB).
 *
 * Auth (two paths):
 *   1. Apex callout — sends `X-Sfdc-Org-Id` header (parity with the rest of
 *      `/api/setup/*`).
 *   2. CLI / external — sends `Authorization: Bearer lr_...`. Because this
 *      route lives under `/api/setup/` (a `PUBLIC_PREFIX` in `proxy.ts`),
 *      the proxy short-circuits before the Bearer-token branch runs. We
 *      resolve the token directly here via `resolveBearerOrgId()`.
 *
 * Behaviour:
 *   - Looks up the org's webhookSecret + sfdcOrgId.
 *   - Constructs a signed POST to the engine's `/route` endpoint with a fake
 *     Lead payload (recordId TEST-<timestamp>, eventType INSERT).
 *   - Times the engine roundtrip and returns the engine's response so the
 *     CLI can surface routed/unmatched status (or any error) to the user.
 *
 * The engine validates the HMAC against the org's webhookSecret, so this
 * end-to-end exercise also confirms the secret is correctly persisted and
 * the engine can reach the database.
 */
export async function POST(req: NextRequest) {
  try {
    const sfdcOrgId = req.headers.get("x-sfdc-org-id");
    const authHeader = req.headers.get("authorization");
    const bearerOrgId = await resolveBearerOrgId(authHeader);

    if (!sfdcOrgId && !bearerOrgId) {
      return NextResponse.json(
        { error: "Missing X-Sfdc-Org-Id header or Bearer token" },
        { status: 401 }
      );
    }

    // Optional caller-supplied overrides.
    let payloadOverride: {
      objectType?: "LEAD" | "CONTACT" | "ACCOUNT";
      fields?: Record<string, unknown>;
    } = {};
    try {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const json = await req.json().catch(() => ({}));
        if (json && typeof json === "object") payloadOverride = json;
      }
    } catch {
      // body is optional
    }

    const org = await prisma.organization.findUnique({
      where: bearerOrgId ? { id: bearerOrgId } : { sfdcOrgId: sfdcOrgId! },
      select: {
        id: true,
        sfdcOrgId: true,
        webhookSecret: true,
      },
    });

    if (!org) {
      return NextResponse.json({ error: "Org not found" }, { status: 404 });
    }
    if (!org.sfdcOrgId) {
      return NextResponse.json(
        { error: "Salesforce org not connected — connect a CRM first" },
        { status: 400 }
      );
    }
    if (!org.webhookSecret) {
      return NextResponse.json(
        { error: "Org webhookSecret missing — re-run setup" },
        { status: 500 }
      );
    }

    const engineUrl =
      process.env.ENGINE_URL ??
      process.env.PUBLIC_ENGINE_URL ??
      "http://engine:3001";

    const objectType = payloadOverride.objectType ?? "LEAD";
    const recordId = `TEST-${Date.now()}`;
    const timestamp = new Date().toISOString();
    const fields = payloadOverride.fields ?? {
      Id: recordId,
      FirstName: "Test",
      LastName: "Lead",
      Email: "test@example.com",
      Company: "Lead Routing Test",
      LeadSource: "CLI Test Event",
    };

    const body = JSON.stringify({
      sfdcOrgId: org.sfdcOrgId,
      objectType,
      eventType: "INSERT",
      recordId,
      timestamp,
      fields,
    });

    const signature =
      "sha256=" +
      crypto
        .createHmac("sha256", org.webhookSecret)
        .update(body)
        .digest("hex");

    console.log(
      `[setup/test-event] orgId=${org.id} → ${engineUrl}/route recordId=${recordId} via=${bearerOrgId ? "bearer" : "apex"}`
    );

    const startMs = Date.now();
    let engineRes: Response;
    try {
      engineRes = await fetch(`${engineUrl}/route`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature-256": signature,
        },
        body,
      });
    } catch (err) {
      const elapsedMs = Date.now() - startMs;
      console.error(
        `[setup/test-event] engine fetch failed after ${elapsedMs}ms:`,
        err
      );
      return NextResponse.json(
        {
          ok: false,
          error: "Engine unreachable",
          details: err instanceof Error ? err.message : String(err),
          elapsedMs,
        },
        { status: 502 }
      );
    }
    const elapsedMs = Date.now() - startMs;

    const text = await engineRes.text();
    let engineBody: unknown;
    try {
      engineBody = JSON.parse(text);
    } catch {
      engineBody = text;
    }

    if (!engineRes.ok) {
      console.error(
        `[setup/test-event] engine returned ${engineRes.status} in ${elapsedMs}ms:`,
        engineBody
      );
      return NextResponse.json(
        {
          ok: false,
          engineStatus: engineRes.status,
          details: engineBody,
          elapsedMs,
        },
        { status: 502 }
      );
    }

    console.log(
      `[setup/test-event] orgId=${org.id} engine OK in ${elapsedMs}ms`
    );

    return NextResponse.json({
      ok: true,
      recordId,
      objectType,
      engineStatus: engineRes.status,
      engineResponse: engineBody,
      elapsedMs,
    });
  } catch (err) {
    console.error("POST /api/setup/test-event error:", err);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
