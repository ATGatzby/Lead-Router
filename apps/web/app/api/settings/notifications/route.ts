import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders, getActorFromHeaders, requireSession, requireRole } from "@/lib/auth";

// GET /api/settings/notifications
export async function GET(_req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();

    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { notificationWebhookUrl: true },
    });

    return NextResponse.json({ webhookUrl: org?.notificationWebhookUrl ?? null });
  } catch (err) {
    console.error("GET /api/settings/notifications error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/settings/notifications (ADMIN only)
export async function PUT(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole(session, "ADMIN");

    const orgId = await getOrgIdFromHeaders();
    const actor = await getActorFromHeaders();

    const body = await req.json();
    const { webhookUrl } = body;

    if (webhookUrl && !webhookUrl.startsWith("https://")) {
      return NextResponse.json({ error: "Webhook URL must use HTTPS" }, { status: 400 });
    }

    const before = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { notificationWebhookUrl: true },
    });

    await prisma.organization.update({
      where: { id: orgId },
      data: { notificationWebhookUrl: webhookUrl || null },
    });

    await prisma.auditLog.create({
      data: {
        orgId,
        actorId: actor.userId,
        actorName: actor.userName,
        action: "NOTIFICATIONS_UPDATED",
        entityType: "Organization",
        entityId: orgId,
        beforeState: { webhookUrl: before?.notificationWebhookUrl },
        afterState: { webhookUrl: webhookUrl || null },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/settings/notifications error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
