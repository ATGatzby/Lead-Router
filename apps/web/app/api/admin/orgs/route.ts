import { NextRequest, NextResponse } from "next/server";
import { prisma, getPlanLimits, startOfNextMonth } from "@lead-routing/db";
import { generateWebhookSecret, generateInviteToken } from "@/lib/crypto";
import { Resend } from "resend";

// GET /api/admin/orgs
export async function GET() {
  try {
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        sfdcOrgId: true,
        plan: true,
        isActive: true,
        seatsPurchased: true,
        seatsUsed: true,
        routingQuotaUsed: true,
        quotaResetAt: true,
        createdAt: true,
        billingInfo: { select: { entityName: true, invoiceEmail: true } },
      },
    });

    const enriched = orgs.map((org) => {
      const plan = org.plan as "FREE" | "PAID";
      return {
        ...org,
        routingQuotaLimit: getPlanLimits(plan).routingLeadsPerMonth,
        quotaPercent: Math.round(
          (org.routingQuotaUsed / getPlanLimits(plan).routingLeadsPerMonth) * 100
        ),
      };
    });

    return NextResponse.json({ orgs: enriched });
  } catch (err) {
    console.error("GET /api/admin/orgs error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/admin/orgs — manually pre-provision a customer org + send invite
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { entityName, inviteEmail, plan = "FREE", seatsPurchased } = body;

    if (!inviteEmail || typeof inviteEmail !== "string" || !inviteEmail.includes("@")) {
      return NextResponse.json({ error: "A valid invite email is required" }, { status: 400 });
    }
    if (!["FREE", "PAID"].includes(plan)) {
      return NextResponse.json({ error: "plan must be FREE or PAID" }, { status: 400 });
    }

    const limits = getPlanLimits(plan as "FREE" | "PAID");
    const inviteToken = generateInviteToken();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    const org = await prisma.organization.create({
      data: {
        webhookSecret: generateWebhookSecret(),
        plan: plan as "FREE" | "PAID",
        isActive: true,
        seatsPurchased: typeof seatsPurchased === "number" ? seatsPurchased : limits.seats,
        routingQuotaUsed: 0,
        quotaResetAt: startOfNextMonth(),
        ...(entityName?.trim()
          ? { billingInfo: { create: { entityName: entityName.trim(), invoiceEmail: inviteEmail.trim() } } }
          : { billingInfo: { create: { invoiceEmail: inviteEmail.trim() } } }
        ),
        invites: {
          create: {
            id: crypto.randomUUID(),
            email: inviteEmail.trim().toLowerCase(),
            token: inviteToken,
            expiresAt,
          },
        },
      },
      select: { id: true, sfdcOrgId: true, plan: true, seatsPurchased: true },
    });

    // Send registration invite email (non-fatal)
    const appUrl = process.env.APP_URL ?? "http://localhost:3000";
    const registerLink = `${appUrl}/register?token=${inviteToken}`;

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "Lead Router <onboarding@resend.dev>",
        to: inviteEmail.trim(),
        subject: "You've been invited to Lead Router",
        html: `
          <p>Hi,</p>
          <p>You've been set up on <strong>Lead Router</strong>${entityName?.trim() ? ` for <strong>${entityName.trim()}</strong>` : ""}.</p>
          <p>Click the link below to create your account (expires in 72 hours):</p>
          <p><a href="${registerLink}" style="font-size:16px;font-weight:bold">Create your account →</a></p>
          <p>Once you're in, you'll connect your Salesforce org to start routing leads.</p>
          <p>— The Lead Router Team</p>
        `,
      });
    } catch (emailErr) {
      console.error("Failed to send invite email:", emailErr);
    }

    return NextResponse.json({ org, inviteLink: registerLink }, { status: 201 });
  } catch (err) {
    console.error("POST /api/admin/orgs error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
