import type { FastifyInstance } from "fastify";
import { prisma, getPlanLimits, startOfNextMonth } from "@lead-routing/db";
import { validateHmac } from "../middleware/validate-signature.js";
import { claimIdempotencyKey } from "../idempotency.js";
import { routeRecord, type RoutingPayload } from "../router.js";

interface WebhookBody {
  sfdcOrgId: string;   // Salesforce org ID (18-char), used to look up internal orgId
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  eventType: "INSERT" | "UPDATE" | "BOTH";
  recordId: string;
  timestamp: string;
  fields: Record<string, unknown>;
}

export async function routePlugin(app: FastifyInstance): Promise<void> {
  app.post<{ Body: WebhookBody }>("/route", {
    config: { rawBody: true },
  }, async (request, reply) => {
    const startMs = Date.now();

    // ── 1. Parse body ──────────────────────────────────────────────────
    const body = request.body;

    if (
      !body?.sfdcOrgId ||
      !body?.objectType ||
      !body?.eventType ||
      !body?.recordId ||
      !body?.timestamp ||
      !body?.fields
    ) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const { sfdcOrgId, objectType, eventType, recordId, timestamp, fields } = body;

    // ── 2. Load org by sfdcOrgId + verify HMAC ────────────────────────
    const org = await prisma.organization.findUnique({
      where: { sfdcOrgId },
      select: {
        id: true,
        webhookSecret: true,
        plan: true,
        isActive: true,
        routingQuotaUsed: true,
        quotaResetAt: true,
      },
    });

    if (!org) {
      return reply.status(401).send({ error: "Unknown org" });
    }

    const orgId = org.id;

    // SFDC Apex sends: X-Signature-256: sha256=<hex>
    const signature = request.headers["x-signature-256"];
    if (!signature || typeof signature !== "string") {
      return reply.status(401).send({ error: "Missing X-Signature-256 header" });
    }

    const rawBody = (request as unknown as { rawBody: string }).rawBody ?? JSON.stringify(body);
    if (!validateHmac(rawBody, signature, org.webhookSecret)) {
      return reply.status(401).send({ error: "Invalid signature" });
    }

    // ── 2.5a. isActive gate ────────────────────────────────────────────
    if (!org.isActive) {
      return reply.status(403).send({ error: "Organization is suspended" });
    }

    // ── 2.5b. Lazy quota reset ─────────────────────────────────────────
    const now = new Date();
    let quotaUsed = org.routingQuotaUsed;
    if (org.quotaResetAt < now) {
      const nextReset = startOfNextMonth();
      await prisma.organization.update({
        where: { id: orgId },
        data: { routingQuotaUsed: 0, quotaResetAt: nextReset },
      });
      quotaUsed = 0;
    }

    // ── 2.5c. Quota gate ───────────────────────────────────────────────
    const limits = getPlanLimits(org.plan as "FREE" | "PAID");
    if (quotaUsed >= limits.routingLeadsPerMonth) {
      return reply.status(429).send({
        error: "quota_exceeded",
        plan: org.plan,
        limit: limits.routingLeadsPerMonth,
        used: quotaUsed,
      });
    }

    // ── 3. Idempotency ─────────────────────────────────────────────────
    const isNew = await claimIdempotencyKey(orgId, recordId, eventType, timestamp);
    if (!isNew) {
      return reply.send({ status: "duplicate", latencyMs: Date.now() - startMs });
    }

    // ── 4. Route ───────────────────────────────────────────────────────
    const payload: RoutingPayload = { orgId, objectType, eventType, recordId, timestamp, fields };

    try {
      const result = await routeRecord(payload);

      // Increment quota for successful routings (not unmatched; dry_run excluded)
      if (result === "routed") {
        await prisma.organization.update({
          where: { id: orgId },
          data: { routingQuotaUsed: { increment: 1 } },
        });
      }

      return reply.send({ status: result, latencyMs: Date.now() - startMs });
    } catch (err) {
      app.log.error({ err, recordId }, "Unhandled routing error");
      return reply.status(500).send({ error: "Internal routing error" });
    }
  });
}
