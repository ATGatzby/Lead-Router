import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@lead-routing/db";
import { bulkUpdateOwners, type BulkUpdateRecord } from "@lead-routing/sfdc";
import { routeRecord, type RoutingPayload } from "./router.js";
import { bulkRouteRecords } from "./bulk-router.js";
import { getOrgConnection } from "./sfdc.js";
import { getOrgHubSpotClient, toCrmObjectType } from "./hubspot-connection.js";

// ─── Job type ─────────────────────────────────────────────────────────────

export interface BulkSearchJobData {
  orgId: string;
  ruleId: string;
  runId: string; // BulkSearchRun.id for tracking
  objectType: string; // "LEAD" | "CONTACT" | "ACCOUNT" | "COMPANY" | "DEAL"
  simulate?: boolean; // Skip routing + CRM write, just count records
  records: Array<{
    recordId: string;
    fields: Record<string, unknown>;
    matchResult: {
      matchedType: string;
      matchedRecordId: string;
      ownerId: string;
      matchField: string;
    } | null;
  }>;
}

// ─── Module state ─────────────────────────────────────────────────────────

let _queue: Queue<BulkSearchJobData> | null = null;
let _worker: Worker<BulkSearchJobData> | null = null;
let _redis: Redis | null = null;

// ─── Exported queue accessor ──────────────────────────────────────────────

export function getBulkSearchQueue(): Queue<BulkSearchJobData> {
  if (!_queue) {
    throw new Error("Bulk search queue not initialized — call initBulkSearchQueue() first");
  }
  return _queue;
}

// For convenience (lazy access pattern used by enqueue callers)
export { _queue as bulkSearchQueue };

/** Get the bulk search worker (for graceful shutdown) */
export function getBulkSearchWorker(): Worker<BulkSearchJobData> | null {
  return _worker;
}

/** Get the bulk search Redis (for graceful shutdown) */
export function getBulkSearchRedis(): Redis | null {
  return _redis;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Capitalise first letter only: LEAD → Lead */
function toSfdcObjectName(objectType: string): string {
  return objectType.charAt(0) + objectType.slice(1).toLowerCase();
}

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || "localhost",
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────

export function initBulkSearchQueue(redisUrl: string): void {
  const redisOpts = parseRedisUrl(redisUrl);

  _redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  _redis.on("error", (err: unknown) => {
    console.error("[bulk-search-queue] Redis error:", err);
  });

  const QUEUE_NAME = "bulk-search-routing";

  _queue = new Queue<BulkSearchJobData>(QUEUE_NAME, {
    connection: _redis,
    defaultJobOptions: {
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 },
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 3000,
      },
    },
  });

  _worker = new Worker<BulkSearchJobData>(
    QUEUE_NAME,
    async (job: Job<BulkSearchJobData>) => {
      const { orgId, ruleId, runId, objectType, records, simulate } = job.data;

      // ── Simulation mode: skip routing + SFDC, just count records ──────
      if (simulate) {
        const count = records.length;
        await new Promise((resolve) => setTimeout(resolve, count * 0.05));
        if (_redis) {
          await _redis.hincrby(`bulk-run:${runId}`, "routed", count);
        }
        return { routed: count, failed: 0 };
      }

      // Determine CRM type for this org
      const orgData = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { crmType: true },
      });
      const isHubSpot = orgData?.crmType === "HUBSPOT";

      // ── Phase A: Bulk evaluate + persist (batched I/O) ──────────────
      const bulkResult = await bulkRouteRecords({
        orgId,
        ruleId,
        runId,
        objectType: objectType as "LEAD" | "CONTACT" | "ACCOUNT" | "COMPANY" | "DEAL",
        records: records.map((r) => ({ recordId: r.recordId, fields: r.fields })),
      });

      const assignments = bulkResult.assignments;
      let routed = 0;
      let failed = bulkResult.failed;

      // ── Phase B: Batch write assignments via SFDC Bulk API 2.0 ──────
      //    Optimization: Skip records whose owner is already correct.
      if (assignments.length > 0) {
        // Set phase in Redis
        if (_redis) {
          await _redis.hset(`bulk-run:${runId}`, "phase", "writing");
        }

        // Build a lookup map: recordId → current owner ID
        const ownerField = isHubSpot ? "hubspot_owner_id" : "OwnerId";
        const currentOwnerMap = new Map<string, string>();
        for (const r of records) {
          const currentOwner = r.fields?.[ownerField];
          if (typeof currentOwner === "string" && currentOwner) {
            currentOwnerMap.set(r.recordId, currentOwner);
          }
        }

        // Partition assignments: skip unchanged vs needs update
        const skippedAssignments: typeof assignments = [];
        const needsUpdateAssignments: typeof assignments = [];

        for (const a of assignments) {
          const currentOwner = currentOwnerMap.get(a.recordId);
          if (currentOwner && a.ownerId && currentOwner === a.ownerId) {
            skippedAssignments.push(a);
          } else {
            needsUpdateAssignments.push(a);
          }
        }

        if (skippedAssignments.length > 0) {
          console.log(
            `[bulk-search-queue] Skipping ${skippedAssignments.length} records (owner unchanged)`
          );
        }

        // Mark skipped records as SUCCESS immediately (owner already correct)
        if (skippedAssignments.length > 0) {
          routed += skippedAssignments.length;

          // Group by assignee to minimize DB update calls
          const skippedAssigneeMap = new Map<string, { logIds: string[]; data: Record<string, unknown> }>();
          for (const a of skippedAssignments) {
            const key = `${a.ownerId}|${a.assigneeName ?? ""}|${a.assignmentType ?? ""}|${a.teamId ?? ""}|${a.teamName ?? ""}`;
            if (!skippedAssigneeMap.has(key)) {
              skippedAssigneeMap.set(key, {
                logIds: [],
                data: {
                  status: "SUCCESS",
                  assigneeId: a.ownerId ?? null,
                  assigneeName: a.assigneeName ?? null,
                  assignmentType: a.assignmentType ?? null,
                  teamId: a.teamId ?? null,
                  teamName: a.teamName ?? null,
                },
              });
            }
            skippedAssigneeMap.get(key)!.logIds.push(a.logId);
          }

          await Promise.allSettled(
            [...skippedAssigneeMap.values()].map((group) =>
              prisma.routingLog.updateMany({
                where: { id: { in: group.logIds } },
                data: group.data,
              })
            )
          );
        }

        // Process remaining assignments that actually need a CRM write
        if (needsUpdateAssignments.length > 0) {
          if (isHubSpot) {
            // ── HubSpot batch update path ──────────────────────────────
            try {
              const { client, crmApi } = await getOrgHubSpotClient(orgId);
              const hubspotObjectType = toCrmObjectType(objectType);

              const BATCH_SIZE = 100;
              const successLogIds: string[] = [];
              const failedLogIds: string[] = [];
              const failedErrors = new Map<string, string>();

              for (let i = 0; i < needsUpdateAssignments.length; i += BATCH_SIZE) {
                const batch = needsUpdateAssignments.slice(i, i + BATCH_SIZE);

                let lastErr: Error | null = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    if (attempt > 0) {
                      await new Promise((r) => setTimeout(r, 2000 * attempt));
                    }

                    const response = await crmApi.batchUpdate(hubspotObjectType, {
                      inputs: batch.map((a) => ({
                        id: a.recordId,
                        properties: { hubspot_owner_id: a.ownerId },
                        objectWriteTraceId: a.logId,
                      })),
                    });

                    const successIds = new Set(response.results.map((r) => r.id));
                    for (const a of batch) {
                      if (successIds.has(a.recordId)) {
                        successLogIds.push(a.logId);
                        routed++;
                      }
                    }

                    if (response.numErrors && response.errors?.length) {
                      for (const a of batch) {
                        if (!successIds.has(a.recordId)) {
                          failedLogIds.push(a.logId);
                          const matchedErr = response.errors?.find((e) =>
                            e.context?.objectWriteTraceId?.includes(a.logId)
                          );
                          const detail = matchedErr
                            ? `${matchedErr.category ?? "UNKNOWN"}: ${matchedErr.message}`
                            : "Batch update failed (no matching error detail)";
                          failedErrors.set(a.logId, detail);
                          failed++;
                        }
                      }
                    }

                    lastErr = null;
                    break;
                  } catch (err: any) {
                    lastErr = err instanceof Error ? err : new Error(String(err));
                    const isRateLimit = err?.statusCode === 429 || err?.message?.includes("429") || err?.name === "HubSpotRateLimitError";
                    if (!isRateLimit || attempt === 2) {
                      for (const a of batch) {
                        failedLogIds.push(a.logId);
                        failedErrors.set(a.logId, lastErr.message);
                        failed++;
                      }
                      lastErr = null;
                      break;
                    }
                    console.warn(`[bulk-search-queue] Rate limited on batch update, retrying (attempt ${attempt + 1})...`);
                  }
                }

                if (i + BATCH_SIZE < needsUpdateAssignments.length) {
                  const suggestedDelay = client.suggestDelay();
                  const delay = Math.max(suggestedDelay, 150);
                  await new Promise((r) => setTimeout(r, delay));
                }
              }

              // Reconcile: update routing logs
              if (successLogIds.length > 0) {
                const assigneeMap = new Map<string, { logIds: string[]; data: Record<string, unknown> }>();
                for (const logId of successLogIds) {
                  const a = needsUpdateAssignments.find((x) => x.logId === logId);
                  const key = `${a?.ownerId ?? ""}|${a?.assigneeName ?? ""}|${a?.assignmentType ?? ""}|${a?.teamId ?? ""}|${a?.teamName ?? ""}`;
                  if (!assigneeMap.has(key)) {
                    assigneeMap.set(key, {
                      logIds: [],
                      data: {
                        status: "SUCCESS",
                        assigneeId: a?.ownerId ?? null,
                        assigneeName: a?.assigneeName ?? null,
                        assignmentType: a?.assignmentType ?? null,
                        teamId: a?.teamId ?? null,
                        teamName: a?.teamName ?? null,
                      },
                    });
                  }
                  assigneeMap.get(key)!.logIds.push(logId);
                }
                await Promise.allSettled(
                  [...assigneeMap.values()].map((group) =>
                    prisma.routingLog.updateMany({
                      where: { id: { in: group.logIds } },
                      data: group.data,
                    })
                  )
                );
              }

              if (failedLogIds.length > 0) {
                const errorGroups = new Map<string, string[]>();
                for (const logId of failedLogIds) {
                  const msg = failedErrors.get(logId) ?? "HubSpot CRM update failed";
                  if (!errorGroups.has(msg)) errorGroups.set(msg, []);
                  errorGroups.get(msg)!.push(logId);
                }
                await Promise.allSettled(
                  [...errorGroups.entries()].map(([msg, ids]) =>
                    prisma.routingLog.updateMany({
                      where: { id: { in: ids } },
                      data: { status: "FAILED", errorMessage: msg },
                    })
                  )
                );
              }
            } catch (err: any) {
              console.error(`[bulk-search-queue] HubSpot bulk write failed:`, err.message);
              const allLogIds = needsUpdateAssignments.map((a) => a.logId);
              if (allLogIds.length > 0) {
                await prisma.routingLog.updateMany({
                  where: { id: { in: allLogIds } },
                  data: { status: "FAILED", errorMessage: `Bulk write error: ${err.message}` },
                });
              }
              failed += needsUpdateAssignments.length;
            }
          } else {
            // ── Salesforce Bulk API 2.0 write path ──────────────────────
            try {
              const conn = await getOrgConnection(orgId);
              const sfdcObjectName = toSfdcObjectName(objectType);
              const updateRecords: BulkUpdateRecord[] = needsUpdateAssignments.map((a) => ({
                Id: a.recordId,
                OwnerId: a.ownerId,
              }));

              const result = await bulkUpdateOwners(
                conn,
                sfdcObjectName,
                updateRecords,
                "lrt__Routing_Action__c"
              );

              if (result.successful.length > 0) {
                const assigneeMap = new Map<string, { logIds: string[]; data: Record<string, unknown> }>();
                for (const successId of result.successful) {
                  const a = needsUpdateAssignments.find((x) => x.recordId === successId);
                  if (!a) continue;
                  const key = `${a.ownerId}|${a.assigneeName ?? ""}|${a.assignmentType ?? ""}|${a.teamId ?? ""}|${a.teamName ?? ""}`;
                  if (!assigneeMap.has(key)) {
                    assigneeMap.set(key, {
                      logIds: [],
                      data: {
                        status: "SUCCESS",
                        assigneeId: a.ownerId ?? null,
                        assigneeName: a.assigneeName ?? null,
                        assignmentType: a.assignmentType ?? null,
                        teamId: a.teamId ?? null,
                        teamName: a.teamName ?? null,
                      },
                    });
                  }
                  assigneeMap.get(key)!.logIds.push(a.logId);
                }

                await Promise.allSettled(
                  [...assigneeMap.values()].map((group) =>
                    prisma.routingLog.updateMany({
                      where: { id: { in: group.logIds } },
                      data: group.data,
                    })
                  )
                );
                routed += result.successful.length;
              }

              if (result.failed.length > 0) {
                const failedIds = new Set(result.failed.map((f) => f.id));
                const failLogIds = needsUpdateAssignments
                  .filter((a) => failedIds.has(a.recordId))
                  .map((a) => a.logId);
                if (failLogIds.length > 0) {
                  await prisma.routingLog.updateMany({
                    where: { id: { in: failLogIds } },
                    data: { status: "FAILED", errorMessage: "Bulk API write failed" },
                  });
                }
                failed += result.failed.length;
              }

              if (result.unprocessed > 0) {
                failed += result.unprocessed;
              }
            } catch (err: any) {
              console.error(`[bulk-search-queue] SFDC bulk write failed:`, err.message);
              const allLogIds = needsUpdateAssignments.map((a) => a.logId);
              if (allLogIds.length > 0) {
                await prisma.routingLog.updateMany({
                  where: { id: { in: allLogIds } },
                  data: { status: "FAILED", errorMessage: `Bulk write error: ${err.message}` },
                });
              }
              failed += needsUpdateAssignments.length;
            }
          }
        }
      }

      // ── Phase C: Update Redis counters ────────────────────────────────
      if (_redis) {
        const key = `bulk-run:${runId}`;
        if (routed > 0) await _redis.hincrby(key, "routed", routed);
        if (failed > 0) await _redis.hincrby(key, "failed", failed);
      }

      return { routed, failed };
    },
    {
      connection: _redis,
      concurrency: 15,
    }
  );

  _worker.on("failed", (job: Job<BulkSearchJobData> | undefined, err: Error) => {
    console.error(
      `[bulk-search-queue] Job ${job?.id ?? "unknown"} failed: ${err.message}`
    );
  });

  _worker.on("error", (err: Error) => {
    console.error("[bulk-search-queue] Worker error:", err);
  });

  console.log("[bulk-search-queue] Queue and worker initialized");
}
