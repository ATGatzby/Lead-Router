import type { FastifyInstance } from "fastify";
import { prisma, getPlanLimits, startOfNextMonth } from "@lead-routing/db";
import { validateHmac } from "../middleware/validate-signature.js";
import { engineRateLimit } from "../middleware/rate-limit.js";
import { claimIdempotencyKey, claimIdempotencyKeys } from "../idempotency.js";
import { routeRecord, type RoutingPayload } from "../router.js";
import { enqueueBatchJobs, type BatchJobData } from "../batch-queue.js";
import { randomUUID } from "node:crypto";
import { routePayloadSchema, batchPayloadSchema } from "../lib/schemas.js";
import { stripPii } from "../lib/strip-pii.js";

interface WebhookBody {
  sfdcOrgId: string;   // Salesforce org ID (18-char), used to look up internal orgId
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  eventType: "INSERT" | "UPDATE" | "BOTH";
  recordId: string;
  timestamp: string;
  fields: Record<string, unknown>;
}

export async function routePlugin(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", engineRateLimit);

  app.post<{ Body: WebhookBody }>("/route", {
    config: { rawBody: true },
  }, async (request, reply) => {
    const startMs = Date.now();

    // ── 1. Parse & validate body ───────────────────────────────────────
    const parsed = routePayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.issues });
    }
    const body = parsed.data;

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
      await prisma.routingLog.create({
        data: {
          orgId,
          sfdcRecordId: recordId,
          objectType,
          eventType,
          status: "FAILED",
          errorMessage: "Organization is suspended",
          recordSnapshot: stripPii(fields) as any,
        },
      });
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
      await prisma.routingLog.create({
        data: {
          orgId,
          sfdcRecordId: recordId,
          objectType,
          eventType,
          status: "FAILED",
          errorMessage: `Quota exceeded: ${quotaUsed.toLocaleString()}/${limits.routingLeadsPerMonth.toLocaleString()} leads used this month`,
          recordSnapshot: stripPii(fields) as any,
        },
      });
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
      const result = await routeRecord(payload, startMs);

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
      await prisma.routingLog.create({
        data: {
          orgId,
          sfdcRecordId: recordId,
          objectType,
          eventType,
          status: "FAILED",
          errorMessage: `Internal routing error: ${err instanceof Error ? err.message : String(err)}`,
          recordSnapshot: stripPii(fields) as any,
        },
      });
      return reply.status(500).send({ error: "Internal routing error" });
    }
  });

  // ── POST /route/batch ──────────────────────────────────────────────────
  // Accepts an array of records in a single HTTP call for high-throughput ingestion.
  // Records are enqueued to BullMQ for parallel processing by workers.

  interface BatchBody {
    sfdcOrgId: string;
    objectType: "LEAD" | "CONTACT" | "ACCOUNT";
    eventType: "INSERT" | "UPDATE" | "BOTH";
    timestamp: string;
    records: Array<{ recordId: string; fields: Record<string, unknown> }>;
  }

  app.post<{ Body: BatchBody }>("/route/batch", {
    config: { rawBody: true },
  }, async (request, reply) => {
    // ── 1. Validate ─────────────────────────────────────────────────────
    const parsed = batchPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.issues });
    }
    const body = parsed.data;

    const { sfdcOrgId, objectType, eventType, timestamp, records } = body;

    // ── 2. Org lookup + HMAC (once for entire batch) ────────────────────
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

    const signature = request.headers["x-signature-256"];
    if (!signature || typeof signature !== "string") {
      return reply.status(401).send({ error: "Missing X-Signature-256 header" });
    }

    const rawBody = (request as unknown as { rawBody: string }).rawBody ?? JSON.stringify(body);
    if (!validateHmac(rawBody, signature, org.webhookSecret)) {
      return reply.status(401).send({ error: "Invalid signature" });
    }

    // ── 3. Active + quota gates ─────────────────────────────────────────
    if (!org.isActive) {
      // Log all records as FAILED so they appear in the activity/failed view
      await prisma.routingLog.createMany({
        data: records.map((r) => ({
          orgId,
          sfdcRecordId: r.recordId,
          objectType,
          eventType,
          status: "FAILED" as const,
          errorMessage: "Organization is suspended",
          recordSnapshot: stripPii(r.fields) as any,
        })),
      });
      return reply.status(403).send({ error: "Organization is suspended" });
    }

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

    const limits = getPlanLimits(org.plan as "FREE" | "PAID");
    const remaining = limits.routingLeadsPerMonth - quotaUsed;
    if (remaining <= 0) {
      const errorMsg = `Quota exceeded: ${quotaUsed.toLocaleString()}/${limits.routingLeadsPerMonth.toLocaleString()} leads used this month`;
      await prisma.routingLog.createMany({
        data: records.map((r) => ({
          orgId,
          sfdcRecordId: r.recordId,
          objectType,
          eventType,
          status: "FAILED" as const,
          errorMessage: errorMsg,
          recordSnapshot: stripPii(r.fields) as any,
        })),
      });
      return reply.status(429).send({
        error: "quota_exceeded",
        plan: org.plan,
        limit: limits.routingLeadsPerMonth,
        used: quotaUsed,
      });
    }

    // ── 4. Bulk idempotency check ───────────────────────────────────────
    const idemMap = await claimIdempotencyKeys(
      orgId,
      records.map((r) => ({ recordId: r.recordId, eventType, timestamp }))
    );

    const newRecords = records.filter((r) => idemMap.get(r.recordId) === true);
    const duplicates = records.length - newRecords.length;

    if (newRecords.length === 0) {
      return reply.status(202).send({ accepted: 0, duplicates });
    }

    // Cap to remaining quota
    const toProcess = newRecords.slice(0, remaining);
    const quotaCapped = newRecords.slice(remaining);
    const quotaReserved = toProcess.length;

    // Log quota-capped records as FAILED
    if (quotaCapped.length > 0) {
      const errorMsg = `Quota exceeded: record dropped (${quotaUsed + quotaReserved}/${limits.routingLeadsPerMonth.toLocaleString()} leads used this month)`;
      await prisma.routingLog.createMany({
        data: quotaCapped.map((r) => ({
          orgId,
          sfdcRecordId: r.recordId,
          objectType,
          eventType,
          status: "FAILED" as const,
          errorMessage: errorMsg,
          recordSnapshot: stripPii(r.fields) as any,
        })),
      });
    }

    // ── 5. Pre-reserve quota atomically ─────────────────────────────────
    await prisma.organization.update({
      where: { id: orgId },
      data: { routingQuotaUsed: { increment: quotaReserved } },
    });

    // ── 6. Enqueue to BullMQ ────────────────────────────────────────────
    const batchId = randomUUID();
    const jobs: BatchJobData[] = toProcess.map((r) => ({
      orgId,
      objectType,
      eventType,
      recordId: r.recordId,
      timestamp,
      fields: r.fields,
      batchId,
    }));

    await enqueueBatchJobs(jobs);

    return reply.status(202).send({
      accepted: toProcess.length,
      duplicates,
      batchId,
    });
  });
}
