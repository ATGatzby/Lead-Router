import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { validateSfdcHmac } from "@/lib/validate-sfdc-hmac";

// GET /api/setup/status?sfdcOrgId=00D...
// Public endpoint — polled by the LWC onboarding wizard before full session exists.
export async function GET(req: NextRequest) {
  try {
    const sfdcOrgId = req.nextUrl.searchParams.get("sfdcOrgId");

    if (!sfdcOrgId) {
      return NextResponse.json({ error: "sfdcOrgId is required" }, { status: 400 });
    }

    // Validate HMAC if signature is present (forward-compatible)
    const signature = req.headers.get("x-signature-256");
    if (signature) {
      const valid = await validateSfdcHmac(sfdcOrgId, "", signature);
      if (!valid) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
      }
    }

    const org = await prisma.organization.findUnique({
      where: { sfdcOrgId },
      select: { id: true, onboardingDone: true },
    });

    return NextResponse.json({
      connected: org !== null,
      onboardingDone: org?.onboardingDone ?? false,
    });
  } catch (err) {
    console.error("GET /api/setup/status error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
