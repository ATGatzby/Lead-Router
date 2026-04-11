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

/** Fetch all synced field API names for an org+objectType from the DB. */
async function getSyncedPropertyNames(orgId: string, objectType: string): Promise<string[] | undefined> {
  const schemas = await prisma.fieldSchema.findMany({
    where: { orgId, objectType: objectType as any },
    select: { fieldApiName: true },
  });
  return schemas.length > 0 ? schemas.map((s) => s.fieldApiName) : undefined;
}

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
          crmRecordId: recordId,
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
          crmRecordId: recordId,
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
          crmRecordId: recordId,
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

    const { sfdcOrgId, objectType, eventType, timestamp, records, ruleId } = body as typeof body & { ruleId?: string };

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
          crmRecordId: r.recordId,
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
          crmRecordId: r.recordId,
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
          crmRecordId: r.recordId,
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
      ...(ruleId ? { ruleId } : {}),
    }));

    await enqueueBatchJobs(jobs);

    return reply.status(202).send({
      accepted: toProcess.length,
      duplicates,
      batchId,
    });
  });

  // ── POST /route/hubspot — native HubSpot webhook receiver ──────────────
  // HubSpot sends an array of event objects. We validate the signature,
  // fetch each record's properties from HubSpot, then feed into routeRecord().

  interface HubSpotEvent {
    objectId: number;
    subscriptionType: string; // e.g. "contact.creation", "company.creation"
    portalId: number;
    occurredAt: number;
    eventId: number;
    subscriptionId: number;
    attemptNumber: number;
    changeSource?: string;
    propertyName?: string;
    propertyValue?: string;
  }

  const SUBSCRIPTION_TO_OBJECT: Record<string, string> = {
    "contact.creation": "CONTACT",
    "contact.propertyChange": "CONTACT",
    "company.creation": "COMPANY",
    "company.propertyChange": "COMPANY",
    "deal.creation": "DEAL",
    "deal.propertyChange": "DEAL",
  };

  const SUBSCRIPTION_TO_EVENT: Record<string, string> = {
    "contact.creation": "INSERT",
    "contact.propertyChange": "UPDATE",
    "company.creation": "INSERT",
    "company.propertyChange": "UPDATE",
    "deal.creation": "INSERT",
    "deal.propertyChange": "UPDATE",
  };

  app.post<{ Body: HubSpotEvent[] }>("/route/hubspot", {
    config: { rawBody: true },
  }, async (request, reply) => {
    const startMs = Date.now();
    const events = request.body;

    if (!Array.isArray(events) || events.length === 0) {
      return reply.status(400).send({ error: "Expected array of events" });
    }

    // All events in a batch share the same portalId
    const portalId = String(events[0].portalId);

    // ── 1. Look up org by portalId ─────────────────────────────────────
    const org = await prisma.organization.findUnique({
      where: { hubspotPortalId: portalId },
      select: { id: true, isActive: true, plan: true, routingQuotaUsed: true, quotaResetAt: true },
    });

    if (!org) {
      app.log.warn({ portalId }, "HubSpot webhook for unknown portal");
      return reply.status(200).send({ status: "unknown_portal" });
    }

    if (!org.isActive) {
      return reply.status(200).send({ status: "org_suspended" });
    }

    // ── 2. Validate HubSpot signature ──────────────────────────────────
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
    if (clientSecret) {
      const sig = request.headers["x-hubspot-signature-v3"] as string | undefined;
      const ts = request.headers["x-hubspot-request-timestamp"] as string | undefined;
      if (sig && ts) {
        const { WebhooksApi } = await import("@lead-routing/hubspot");
        const webhooks = new WebhooksApi("", "");
        const rawBody = (request as unknown as { rawBody: string }).rawBody ?? JSON.stringify(events);
        const fullUrl = `https://${request.headers.host ?? ""}${request.url}`;
        const valid = webhooks.validateSignature(rawBody, sig, clientSecret, fullUrl, "POST", ts);
        if (!valid) {
          app.log.warn("HubSpot webhook signature validation failed");
          return reply.status(401).send({ error: "Invalid signature" });
        }
      }
    }

    // ── 3. Process each event ──────────────────────────────────────────
    const { getOrgHubSpotClient, toCrmObjectType } = await import("../hubspot-connection.js");
    const results: Array<{ eventId: number; status: string }> = [];

    for (const event of events) {
      const objectType = SUBSCRIPTION_TO_OBJECT[event.subscriptionType];
      const eventType = SUBSCRIPTION_TO_EVENT[event.subscriptionType];
      if (!objectType || !eventType) {
        results.push({ eventId: event.eventId, status: "unsupported_type" });
        continue;
      }

      const recordId = String(event.objectId);
      const timestamp = new Date(event.occurredAt).toISOString();

      // Dedupe
      const isNew = await claimIdempotencyKey(org.id, recordId, eventType, timestamp);
      if (!isNew) {
        results.push({ eventId: event.eventId, status: "duplicate" });
        continue;
      }

      // Fetch record properties from HubSpot (all synced fields)
      let fields: Record<string, unknown>;
      try {
        const { crmApi } = await getOrgHubSpotClient(org.id);
        const properties = await getSyncedPropertyNames(org.id, objectType);
        const record = await crmApi.getObject(toCrmObjectType(objectType), recordId, properties);
        fields = record.properties ?? {};
      } catch (err) {
        app.log.error({ err, recordId, objectType }, "Failed to fetch record from HubSpot");
        results.push({ eventId: event.eventId, status: "fetch_failed" });
        continue;
      }

      // Route
      const payload: RoutingPayload = {
        orgId: org.id,
        objectType: objectType as any,
        eventType: eventType as "INSERT" | "UPDATE",
        recordId,
        timestamp,
        fields,
      };

      try {
        const result = await routeRecord(payload, startMs);
        if (result === "routed") {
          await prisma.organization.update({
            where: { id: org.id },
            data: { routingQuotaUsed: { increment: 1 } },
          });
        }
        results.push({ eventId: event.eventId, status: result });
      } catch (err) {
        app.log.error({ err, recordId }, "Routing error for HubSpot event");
        results.push({ eventId: event.eventId, status: "error" });
      }
    }

    app.log.info({ portalId, processed: results.length, latencyMs: Date.now() - startMs }, "HubSpot webhook batch processed");
    return reply.send({ results, latencyMs: Date.now() - startMs });
  });
}
