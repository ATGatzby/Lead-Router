import { prisma } from "@lead-routing/db";
import type { FilterGroup } from "@lead-routing/hubspot";
import { getOrgHubSpotClient } from "./hubspot-connection.js";
import { streamCSVRecords } from "./lib/csv-parser.js";
import { getBulkSearchQueue, type BulkSearchJobData } from "./bulk-search-queue.js";
import { redis } from "./redis.js";
import type { CachedMatchConfig } from "./cache.js";
import { evaluateRule } from "./evaluator.js";

const EXPORT_POLL_INTERVAL_MS = 10_000;
const EXPORT_POLL_MAX_MS = 4 * 60 * 60 * 1000; // 4 hours
const BACK_PRESSURE_THRESHOLD = 10_000;

/** Dynamic batch size based on estimated total records */
function getEnqueueBatchSize(estimatedTotal: number): number {
  if (estimatedTotal < 1_000) return 200;
  if (estimatedTotal < 10_000) return 300;
  return 500;
}

export interface ExportRunResult {
  status: "SUCCESS" | "FAILED" | "CANCELLED";
  recordsFound: number;
  recordsRouted: number;
  recordsFailed: number;
  durationMs: number;
  error?: string;
}

/**
 * Run a scheduled route using the HubSpot Export API for large datasets (>10K records).
 *
 * Flow:
 * 1. Start async export via HubSpot API
 * 2. Poll for completion
 * 3. Download CSV from signed URL
 * 4. Stream-parse CSV into record batches
 * 5. Enqueue batches to bulk-search-routing BullMQ queue
 * 6. Wait for all jobs to complete
 */
export async function runExportRoute(
  orgId: string,
  ruleId: string,
  objectType: string,
  filterGroups: FilterGroup[],
  properties: string[],
  opts: {
    runId: string;
    batchSize?: number;
    maxRecords?: number | null;
    matchConfig?: CachedMatchConfig | null;
    estimatedTotal?: number;
    searchCriteria?: any[] | null;
  },
): Promise<ExportRunResult> {
  const startMs = Date.now();
  const runId = opts.runId;
  const batchSize = opts.batchSize ?? getEnqueueBatchSize(opts.maxRecords ?? 50_000);
  const runKey = `bulk-run:${runId}`;

  // Map object type to HubSpot API format
  const hsObjectType = objectType === "CONTACT" ? "contacts"
    : objectType === "COMPANY" ? "companies"
    : "deals";

  try {
    // ── Phase 1: Start export + poll ──────────────────────────────────
    await redis.hset(runKey, {
      status: "RUNNING",
      phase: "exporting",
      totalRecords: String(opts.estimatedTotal ?? 0),
    });
    await redis.expire(runKey, 86400); // 24h TTL

    const { exportApi } = await getOrgHubSpotClient(orgId);

    // Check for concurrent export lock
    const lockKey = `export-lock:${orgId}`;
    const locked = await redis.set(lockKey, runId, "EX", 14400, "NX"); // 4hr TTL
    if (!locked) {
      throw new Error("Another export is already running for this organization");
    }

    let exportId: string;
    try {
      const exportResult = await exportApi.startExport({
        exportType: "VIEW",
        format: "CSV",
        exportName: `lead-routing-${ruleId}-${Date.now()}`,
        objectType: hsObjectType,
        objectProperties: properties,
        filterGroups: filterGroups.length > 0 ? filterGroups : undefined,
      });
      exportId = exportResult.id;
    } catch (err: any) {
      await redis.del(lockKey);
      throw new Error(`Failed to start export: ${err.message}`);
    }

    await redis.hset(runKey, { exportId, phase: "exporting" });
    console.log(`[export-runner] Export started: ${exportId} for rule ${ruleId}`);

    // Poll for completion
    const pollStart = Date.now();
    let exportStatus: any;
    while (Date.now() - pollStart < EXPORT_POLL_MAX_MS) {
      // Check cancel flag
      const cancelled = await redis.hget(runKey, "cancel");
      if (cancelled === "true") {
        await redis.del(lockKey);
        return { status: "CANCELLED", recordsFound: 0, recordsRouted: 0, recordsFailed: 0, durationMs: Date.now() - startMs };
      }

      exportStatus = await exportApi.getExportStatus(exportId);
      console.log(`[export-runner] Poll: status=${exportStatus.status}, result=${exportStatus.result ? 'yes' : 'no'}, completedAt=${exportStatus.completedAt ?? 'n/a'}`);
      await redis.hset(runKey, { exportStatus: exportStatus.status });

      // HubSpot may set result/completedAt before transitioning status to COMPLETE
      if (exportStatus.status === "COMPLETE" || (exportStatus.result && exportStatus.completedAt)) break;
      if (exportStatus.status === "FAILED" || exportStatus.status === "CANCELLED") {
        await redis.del(lockKey);
        throw new Error(`Export ${exportStatus.status.toLowerCase()}`);
      }

      await new Promise(r => setTimeout(r, EXPORT_POLL_INTERVAL_MS));
    }

    if (!exportStatus?.result && exportStatus?.status !== "COMPLETE") {
      await redis.del(lockKey);
      throw new Error("Export timed out after 4 hours");
    }

    const downloadUrl = exportStatus.result;
    if (!downloadUrl) {
      await redis.del(lockKey);
      throw new Error("Export completed but no download URL returned");
    }

    // ── Phase 2: Download + parse + enqueue ──────────────────────────
    await redis.hset(runKey, { phase: "downloading" });
    console.log(`[export-runner] Downloading export: ${exportId}`);

    const response = await exportApi.downloadExport(downloadUrl);
    const contentType = response.headers.get("content-type") ?? "";
    const isZip = contentType.includes("zip") || contentType.includes("octet-stream");

    await redis.hset(runKey, { phase: "routing" });
    await redis.del(lockKey); // Release export lock after download

    // Build display→API name map from field_schemas so CSV headers match condition field names
    const fieldSchemas = await prisma.fieldSchema.findMany({
      where: { orgId, objectType: objectType.toUpperCase() === "CONTACTS" ? "CONTACT" : objectType.toUpperCase() === "COMPANIES" ? "COMPANY" : objectType.toUpperCase() === "DEALS" ? "DEAL" : objectType as any },
      select: { fieldApiName: true, fieldLabel: true },
    });
    const columnRenameMap = new Map<string, string>();
    for (const fs of fieldSchemas) {
      if (fs.fieldLabel && fs.fieldLabel !== fs.fieldApiName) {
        columnRenameMap.set(fs.fieldLabel, fs.fieldApiName);
      }
    }
    // Also map common HubSpot export headers that aren't in field_schemas
    columnRenameMap.set("Record ID", "hs_object_id");

    // Build client-side filter from searchCriteria (Export API may ignore some operators like NEQ)
    const evalConditions = buildEvalConditions(opts.searchCriteria);

    let totalEnqueued = 0;
    let totalFiltered = 0;
    const queue = getBulkSearchQueue();

    if (isZip) {
      // ZIP handling — extract and process each CSV
      const buffer = Buffer.from(await response.arrayBuffer());
      const { default: yauzl } = await import("yauzl");

      await new Promise<void>((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (err: any, zipfile: any) => {
          if (err) return reject(err);

          zipfile.readEntry();
          zipfile.on("entry", async (entry: any) => {
            if (!entry.fileName.endsWith(".csv")) {
              zipfile.readEntry();
              return;
            }

            zipfile.openReadStream(entry, async (streamErr: any, readStream: any) => {
              if (streamErr) return reject(streamErr);

              // Convert Node stream to Web ReadableStream
              const { Readable } = await import("node:stream");
              const webStream = Readable.toWeb(readStream) as ReadableStream<Uint8Array>;

              for await (const batch of streamCSVRecords(webStream, batchSize, columnRenameMap)) {
                if (opts.maxRecords && totalEnqueued >= opts.maxRecords) break;

                // Client-side filter: remove records that don't match searchCriteria
                let records = batch;
                if (evalConditions.length > 0) {
                  const filtered = [];
                  for (const r of records) {
                    if (await evaluateRule(r.fields as Record<string, unknown>, evalConditions)) {
                      filtered.push(r);
                    } else {
                      totalFiltered++;
                    }
                  }
                  records = filtered;
                }
                if (records.length === 0) continue;

                if (opts.maxRecords) {
                  records = records.slice(0, opts.maxRecords - totalEnqueued);
                }

                const jobData: BulkSearchJobData = {
                  orgId,
                  ruleId,
                  runId,
                  objectType: objectType as "CONTACT" | "COMPANY" | "DEAL",
                  records: records.map(r => ({
                    recordId: r.recordId,
                    fields: r.fields as Record<string, unknown>,
                    matchResult: null,
                  })),
                  simulate: false,
                };

                await queue.add(`export-batch-${totalEnqueued}`, jobData);
                totalEnqueued += records.length;
                await redis.hset(runKey, { processed: String(totalEnqueued) });

                // Back-pressure
                const waiting = await queue.getWaitingCount();
                while (waiting > BACK_PRESSURE_THRESHOLD) {
                  await new Promise(r => setTimeout(r, 2000));
                }
              }

              zipfile.readEntry();
            });
          });

          zipfile.on("end", resolve);
          zipfile.on("error", reject);
        });
      });
    } else {
      // Direct CSV
      const body = response.body;
      if (!body) throw new Error("Export response has no body");

      for await (const batch of streamCSVRecords(body, batchSize, columnRenameMap)) {
        if (opts.maxRecords && totalEnqueued >= opts.maxRecords) break;

        // Client-side filter: remove records that don't match searchCriteria
        let records = batch;
        if (evalConditions.length > 0) {
          const filtered = [];
          for (const r of records) {
            if (await evaluateRule(r.fields as Record<string, unknown>, evalConditions)) {
              filtered.push(r);
            } else {
              totalFiltered++;
            }
          }
          records = filtered;
        }
        if (records.length === 0) continue;

        if (opts.maxRecords) {
          records = records.slice(0, opts.maxRecords - totalEnqueued);
        }

        const jobData: BulkSearchJobData = {
          orgId,
          ruleId,
          runId,
          objectType: objectType as "CONTACT" | "COMPANY" | "DEAL",
          records: records.map(r => ({
            recordId: r.recordId,
            fields: r.fields as Record<string, unknown>,
            matchResult: null,
          })),
          simulate: false,
        };

        await queue.add(`export-batch-${totalEnqueued}`, jobData);
        totalEnqueued += records.length;
        await redis.hset(runKey, { processed: String(totalEnqueued) });

        // Back-pressure
        const waiting = await queue.getWaitingCount();
        while (waiting > BACK_PRESSURE_THRESHOLD) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    if (totalFiltered > 0) {
      console.log(`[export-runner] Filtered out ${totalFiltered} records that didn't match search criteria`);
    }
    console.log(`[export-runner] Enqueued ${totalEnqueued} records for routing`);
    await redis.hset(runKey, { totalRecords: String(totalEnqueued), phase: "writing" });

    // ── Phase 3: Wait for completion ─────────────────────────────────
    const POLL_INTERVAL = 2000;
    const MAX_WAIT = 30 * 60 * 1000; // 30 min
    const waitStart = Date.now();

    while (Date.now() - waitStart < MAX_WAIT) {
      const data = await redis.hgetall(runKey);
      const routed = parseInt(data.routed || "0");
      const failed = parseInt(data.failed || "0");

      if (routed + failed >= totalEnqueued) {
        const durationMs = Date.now() - startMs;

        // Update DB
        await prisma.bulkSearchRun.update({
          where: { id: runId },
          data: {
            status: failed > 0 && routed === 0 ? "FAILED" : "SUCCESS",
            recordsFound: totalEnqueued,
            recordsRouted: routed,
            recordsFailed: failed,
            durationMs,
            completedAt: new Date(),
          },
        }).catch(() => {});

        await redis.del(runKey);

        console.log(`[export-runner] Complete: ${routed} routed, ${failed} failed, ${durationMs}ms`);
        return {
          status: failed > 0 && routed === 0 ? "FAILED" : "SUCCESS",
          recordsFound: totalEnqueued,
          recordsRouted: routed,
          recordsFailed: failed,
          durationMs,
        };
      }

      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }

    // Timeout
    return {
      status: "FAILED",
      recordsFound: totalEnqueued,
      recordsRouted: 0,
      recordsFailed: 0,
      durationMs: Date.now() - startMs,
      error: "Timed out waiting for routing jobs to complete",
    };

  } catch (err: any) {
    const durationMs = Date.now() - startMs;
    console.error(`[export-runner] Error:`, err);

    await redis.hset(runKey, { status: "FAILED", error: err.message });
    await prisma.bulkSearchRun.update({
      where: { id: runId },
      data: { status: "FAILED", durationMs, completedAt: new Date() },
    }).catch(() => {});

    return {
      status: "FAILED",
      recordsFound: 0,
      recordsRouted: 0,
      recordsFailed: 0,
      durationMs,
      error: err.message,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert searchCriteria (UI condition groups) to flat EvalCondition[] for evaluateRule().
 * This enables client-side filtering of exported records when the Export API
 * doesn't fully support all filter operators (e.g., NEQ).
 */
function buildEvalConditions(
  searchCriteria: any[] | null | undefined,
): Array<{ groupId: string; fieldName: string; fieldType: string; operator: string; value: string | null }> {
  if (!searchCriteria || searchCriteria.length === 0) return [];

  return searchCriteria.flatMap((group: any) => {
    if (Array.isArray(group.conditions)) {
      return group.conditions.map((c: any) => ({
        groupId: group.id ?? "default",
        fieldName: c.fieldApiName ?? c.fieldName ?? c.field,
        fieldType: c.fieldType ?? "TEXT",
        operator: c.operator,
        value: c.value ?? null,
      }));
    }
    if (group.fieldApiName || group.fieldName || group.field) {
      return [{
        groupId: group.groupId ?? "default",
        fieldName: group.fieldApiName ?? group.fieldName ?? group.field,
        fieldType: group.fieldType ?? "TEXT",
        operator: group.operator,
        value: group.value ?? null,
      }];
    }
    return [];
  });
}
