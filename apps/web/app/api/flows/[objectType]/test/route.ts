import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

const VALID_OBJECT_TYPES = ["LEAD", "CONTACT", "ACCOUNT"];

// POST /api/flows/:objectType/test — send a test record through the flow
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ objectType: string }> }
) {
  try {
    const { objectType } = await params;
    const orgId = await getOrgIdFromHeaders();

    if (!VALID_OBJECT_TYPES.includes(objectType)) {
      return NextResponse.json({ error: "Invalid objectType" }, { status: 400 });
    }

    const body = await req.json();
    const { recordId } = body;

    if (!recordId?.trim()) {
      return NextResponse.json({ error: "recordId is required" }, { status: 400 });
    }

    // Verify the flow exists and is active
    const flow = await prisma.routingFlow.findUnique({
      where: { orgId_objectType: { orgId, objectType: objectType as any } },
      select: { id: true, status: true },
    });
    if (!flow) {
      return NextResponse.json({ error: "Flow not found" }, { status: 404 });
    }

    // Look up the org's sfdcOrgId and webhook secret for engine auth
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { sfdcOrgId: true, webhookSecret: true },
    });
    if (!org?.sfdcOrgId) {
      return NextResponse.json({ error: "Organization not found or missing Salesforce Org ID" }, { status: 404 });
    }

    const engineUrl = process.env.ENGINE_URL;
    if (!engineUrl) {
      return NextResponse.json(
        { error: "ENGINE_URL not configured" },
        { status: 500 }
      );
    }

    // Send test event to the engine (must match routePayloadSchema + HMAC sig)
    const payload = JSON.stringify({
      sfdcOrgId: org.sfdcOrgId,
      objectType,
      eventType: "INSERT",
      recordId: recordId.trim(),
      timestamp: new Date().toISOString(),
      fields: {},
      isTest: true,
      routeVia: "FLOW",
    });

    const hmac = crypto.createHmac("sha256", org.webhookSecret).update(payload).digest("hex");

    const response = await fetch(`${engineUrl}/route`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature-256": `sha256=${hmac}`,
      },
      body: payload,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Engine test route error:", response.status, text);
      return NextResponse.json(
        { success: false, message: `Engine returned ${response.status}: ${text}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Test event sent for ${objectType} record ${recordId}`,
    });
  } catch (err) {
    console.error("POST /api/flows/:objectType/test error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
