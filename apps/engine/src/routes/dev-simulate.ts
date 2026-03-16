import type { FastifyInstance } from "fastify";
import { prisma } from "@lead-routing/db";
import { getRedis } from "../redis.js";
import { getBulkSearchQueue } from "../bulk-search-queue.js";

// ─── Mock data pools ────────────────────────────────────────────────────────

const FIRST_NAMES = [
  "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael", "Linda",
  "David", "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Charles", "Karen", "Daniel", "Lisa", "Matthew", "Nancy",
  "Anthony", "Betty", "Mark", "Margaret", "Donald", "Sandra", "Steven", "Ashley",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson",
  "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson",
  "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker",
];

const COMPANIES = [
  "Acme Corp", "TechVision Inc", "Global Industries", "Pinnacle Solutions",
  "Quantum Labs", "Vertex Digital", "Summit Technologies", "NovaTech",
  "Catalyst Systems", "Horizon Dynamics", "Apex Innovations", "Cypher Networks",
  "Fusion Analytics", "Zenith Partners", "Atlas Engineering", "Prism Software",
  "Vanguard Health", "Nexus Financial", "Cobalt Media", "Sterling Logistics",
];

const INDUSTRIES = [
  "Technology", "Finance", "Healthcare", "Manufacturing", "Retail",
  "Education", "Energy", "Real Estate", "Telecommunications", "Transportation",
  "Agriculture", "Consulting", "Insurance", "Pharmaceuticals", "Aerospace",
];

const LEAD_SOURCES = [
  "Web", "Phone Inquiry", "Partner Referral", "Purchased List",
  "Other", "Trade Show", "Employee Referral", "Advertisement",
];

const TITLES = [
  "CEO", "CTO", "VP of Sales", "Director of Marketing", "Engineering Manager",
  "Product Manager", "Account Executive", "Software Engineer", "CFO", "COO",
  "Head of Growth", "VP of Engineering", "Sales Director", "Marketing Manager",
  "IT Director", "Operations Manager", "Business Analyst", "Data Scientist",
];

const STATES = [
  "CA", "TX", "NY", "FL", "IL", "PA", "OH", "GA", "NC", "MI",
  "NJ", "VA", "WA", "AZ", "MA", "TN", "IN", "MO", "MD", "WI",
];

// ─── Record generator ───────────────────────────────────────────────────────

function generateSimRecord(index: number, objectType: string): Record<string, unknown> {
  const firstName = FIRST_NAMES[index % FIRST_NAMES.length]!;
  const lastName = LAST_NAMES[(index * 7) % LAST_NAMES.length]!;
  const company = COMPANIES[(index * 3) % COMPANIES.length]!;
  const industry = INDUSTRIES[(index * 11) % INDUSTRIES.length]!;
  const domain = company.toLowerCase().replace(/\s+/g, "").replace(/[^a-z]/g, "") + ".com";

  const base: Record<string, unknown> = {
    Id: `00Q${String(index).padStart(15, "0")}`,
    FirstName: firstName,
    LastName: lastName,
    Email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@${domain}`,
    Company: company,
    Industry: industry,
    Title: TITLES[(index * 13) % TITLES.length],
    LeadSource: LEAD_SOURCES[(index * 5) % LEAD_SOURCES.length],
    State: STATES[(index * 17) % STATES.length],
    AnnualRevenue: Math.floor(100000 + (index * 73 % 50000000)),
    NumberOfEmployees: Math.floor(10 + (index * 31 % 50000)),
    Phone: `(${String(200 + (index % 800)).padStart(3, "0")}) ${String(200 + (index * 7 % 800)).padStart(3, "0")}-${String(1000 + (index % 9000)).padStart(4, "0")}`,
    Website: `https://www.${domain}`,
    CreatedDate: new Date(Date.now() - (index * 60000) % (365 * 24 * 60 * 60 * 1000)).toISOString(),
  };

  if (objectType === "CONTACT" || objectType === "ACCOUNT") {
    // Swap Lead-specific ID prefix
    base.Id = objectType === "CONTACT"
      ? `003${String(index).padStart(15, "0")}`
      : `001${String(index).padStart(15, "0")}`;
  }

  if (objectType === "ACCOUNT") {
    base.Name = company;
    delete base.FirstName;
    delete base.LastName;
    delete base.Email;
    delete base.LeadSource;
    delete base.Title;
  }

  return base;
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export async function devSimulatePlugin(app: FastifyInstance): Promise<void> {

  // POST /dev/simulate-bulk-run
  app.post("/dev/simulate-bulk-run", async (request, reply) => {
    const {
      recordCount = 100_000,
      batchSize = 10_000,
      objectType = "LEAD",
      orgId: requestedOrgId,
    } = request.body as {
      recordCount?: number;
      batchSize?: number;
      objectType?: string;
      orgId?: string;
    };

    // Validate inputs
    if (recordCount < 1 || recordCount > 10_000_000) {
      return reply.status(400).send({ error: "recordCount must be between 1 and 10,000,000" });
    }
    if (batchSize < 100 || batchSize > 50_000) {
      return reply.status(400).send({ error: "batchSize must be between 100 and 50,000" });
    }
    if (!["LEAD", "CONTACT", "ACCOUNT"].includes(objectType)) {
      return reply.status(400).send({ error: "objectType must be LEAD, CONTACT, or ACCOUNT" });
    }

    // Find org
    const org = requestedOrgId
      ? await prisma.organization.findUnique({ where: { id: requestedOrgId } })
      : await prisma.organization.findFirst();
    if (!org) {
      return reply.status(400).send({ error: "No organization found. Set up the app first." });
    }

    // Find or create a rule (FK constraint requires a real rule)
    let rule = await prisma.routingRule.findFirst({
      where: { orgId: org.id, name: "[Simulation] Bulk Test" },
    });
    if (!rule) {
      rule = await prisma.routingRule.findFirst({
        where: { orgId: org.id, status: "ACTIVE" },
      });
    }
    if (!rule) {
      rule = await prisma.routingRule.create({
        data: {
          orgId: org.id,
          name: "[Simulation] Bulk Test",
          objectType: objectType as any,
          routeType: "SCHEDULED",
          status: "ACTIVE",
          priority: 999,
          triggerEvent: "SEARCH",
        },
      });
    }

    // Create DB run row
    const run = await prisma.bulkSearchRun.create({
      data: {
        orgId: org.id,
        ruleId: rule.id,
        recordsFound: recordCount,
        status: "RUNNING",
        batchSize,
        maxRecords: recordCount,
      },
    });

    // Initialize Redis progress
    const redis = getRedis();
    await redis.hset(`bulk-run:${run.id}`, {
      status: "RUNNING",
      phase: "routing",
      processed: "0",
      routed: "0",
      failed: "0",
      writePending: "0",
    });

    const totalBatches = Math.ceil(recordCount / batchSize);

    // Return immediately — processing happens async
    reply.send({
      runId: run.id,
      ruleId: rule.id,
      orgId: org.id,
      recordCount,
      batchSize,
      totalBatches,
      statusUrl: `/bulk-run/${run.id}/status`,
      cancelUrl: `/bulk-run/${run.id}/cancel`,
      message: `Simulation started. ${recordCount.toLocaleString()} records in ${totalBatches} batches.`,
    });

    // Enqueue batches asynchronously (after response is sent)
    setImmediate(async () => {
      const startTime = Date.now();
      try {
        const queue = getBulkSearchQueue();

        for (let i = 0; i < totalBatches; i++) {
          const start = i * batchSize;
          const end = Math.min(start + batchSize, recordCount);
          const records = [];

          for (let j = start; j < end; j++) {
            records.push({
              recordId: `00Q${String(j).padStart(15, "0")}`,
              fields: generateSimRecord(j, objectType),
              matchResult: null,
            });
          }

          await queue.add(`sim-batch-${run.id}-${i}`, {
            orgId: org.id,
            ruleId: rule.id,
            runId: run.id,
            objectType,
            records,
            simulate: true,
          } as any);

          // Check cancel flag
          const cancelled = await redis.exists(`bulk-run:${run.id}:cancel`);
          if (cancelled) {
            await prisma.bulkSearchRun.update({
              where: { id: run.id },
              data: { status: "CANCELLED", completedAt: new Date(), durationMs: Date.now() - startTime },
            });
            console.log(`[simulate] Run ${run.id} cancelled after ${i + 1} batches`);
            return;
          }
        }

        console.log(`[simulate] All ${totalBatches} batches enqueued for run ${run.id}`);

        // Wait for worker to finish processing all batches
        const maxWaitMs = 30 * 60 * 1000; // 30 min timeout
        const pollIntervalMs = 2000;
        const waitStart = Date.now();

        while (Date.now() - waitStart < maxWaitMs) {
          const [routedStr, failedStr] = await redis.hmget(`bulk-run:${run.id}`, "routed", "failed");
          const routed = parseInt(routedStr ?? "0", 10);
          const failed = parseInt(failedStr ?? "0", 10);

          if (routed + failed >= recordCount) break;

          // Check for cancellation while waiting
          const cancelExists = await redis.exists(`bulk-run:${run.id}:cancel`);
          if (cancelExists) {
            await prisma.bulkSearchRun.update({
              where: { id: run.id },
              data: { status: "CANCELLED", completedAt: new Date(), durationMs: Date.now() - startTime },
            });
            return;
          }

          await new Promise((r) => setTimeout(r, pollIntervalMs));
        }

        // Read final counts from Redis
        const [routedStr, failedStr] = await redis.hmget(`bulk-run:${run.id}`, "routed", "failed");
        const recordsRouted = parseInt(routedStr ?? "0", 10);
        const recordsFailed = parseInt(failedStr ?? "0", 10);
        const durationMs = Date.now() - startTime;

        // Determine final status
        let status: string;
        if (recordsFailed === 0 && recordsRouted > 0) {
          status = "COMPLETE";
        } else if (recordsRouted > 0 && recordsFailed > 0) {
          status = "COMPLETE"; // partial but complete
        } else if (recordsFailed > 0 && recordsRouted === 0) {
          status = "FAILED";
        } else {
          status = "COMPLETE";
        }

        await prisma.bulkSearchRun.update({
          where: { id: run.id },
          data: {
            status,
            recordsProcessed: recordsRouted + recordsFailed,
            recordsRouted,
            recordsFailed,
            completedAt: new Date(),
            durationMs,
          },
        });

        // Clean up Redis keys
        await redis.del(`bulk-run:${run.id}`, `bulk-run:${run.id}:cancel`);

        console.log(
          `[simulate] Run ${run.id} complete: ${recordsRouted.toLocaleString()} routed, ${recordsFailed.toLocaleString()} failed in ${durationMs}ms`
        );
      } catch (err: any) {
        console.error("[simulate] Error:", err.message);
        await prisma.bulkSearchRun.update({
          where: { id: run.id },
          data: {
            status: "FAILED",
            error: err.message?.slice(0, 2000) ?? "Unknown error",
            completedAt: new Date(),
            durationMs: Date.now() - startTime,
          },
        });
      }
    });
  });
}
