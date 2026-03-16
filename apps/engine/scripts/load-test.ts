/**
 * Lead Routing — Bulk Search Pipeline Load Test
 *
 * Simulates N Salesforce records flowing through the bulk search pipeline
 * using TRUE STREAMING — records are generated, buffered into micro-batches,
 * processed, then discarded. Memory stays flat regardless of record count.
 *
 * Usage:
 *   cd apps/engine && npx tsx scripts/load-test.ts --records 10000000
 *   cd apps/engine && pnpm load-test -- -n 1000000 -b 10000
 *
 * Flags:
 *   --records, -n        Number of records (default: 100000)
 *   --batch-size, -b     Micro-batch size (default: 500)
 *   --with-matching      Enable batch matcher simulation (default: true)
 *   --match-hit-rate     Percentage of records that "match" (default: 0)
 */

import { batchMatchRecords, type CachedMatchConfig } from "../src/batch-matcher.js";

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const opts = {
    records: 100_000,
    batchSize: 500,
    withMatching: true,
    matchHitRate: 0,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const next = args[i + 1];
    if ((arg === "--records" || arg === "-n") && next) {
      opts.records = parseInt(next, 10);
      i++;
    } else if ((arg === "--batch-size" || arg === "-b") && next) {
      opts.batchSize = parseInt(next, 10);
      i++;
    } else if (arg === "--with-matching") {
      opts.withMatching =
        next === "true" || next === undefined || next?.startsWith("-")
          ? true
          : next === "false"
            ? false
            : true;
      if (next && !next.startsWith("-") && (next === "true" || next === "false"))
        i++;
    } else if (arg === "--match-hit-rate" && next) {
      opts.matchHitRate = parseFloat(next);
      i++;
    }
  }

  return opts;
}

// ─── Synthetic Record Generation ─────────────────────────────────────────────

const COMPANIES = [
  "Acme Corp", "TechVision Inc", "Global Industries", "Pinnacle Systems",
  "Vertex Solutions", "Quantum Dynamics", "Apex Digital", "NovaTech",
  "Meridian Group", "Catalyst Ventures", "Horizon Labs", "Summit Analytics",
  "Fusion Enterprises", "Orion Software", "Paladin Security", "Zenith Cloud",
  "Atlas Manufacturing", "Beacon Health", "Cobalt Financial", "Delta Logistics",
  "Eclipse Media", "Frontier Energy", "Granite Construction", "Helix Biotech",
  "Ionic Systems", "Jade Consulting", "Keystone Partners", "Lunar Robotics",
  "Mosaic Design", "Neptune Data", "Oasis Retail", "Prism Analytics",
];

const INDUSTRIES = [
  "Technology", "Finance", "Healthcare", "Manufacturing", "Retail",
  "Energy", "Media", "Education", "Real Estate", "Transportation",
  "Consulting", "Biotechnology", "Telecommunications", "Insurance",
  "Agriculture", "Aerospace",
];

const STATES = [
  "CA", "TX", "NY", "FL", "IL", "PA", "OH", "GA", "NC", "MI",
  "NJ", "VA", "WA", "AZ", "MA", "TN", "IN", "MO", "MD", "WI",
  "CO", "MN", "SC", "AL", "LA", "KY", "OR", "OK", "CT", "UT",
];

const LEAD_SOURCES = [
  "Web", "Phone Inquiry", "Partner Referral", "Trade Show",
  "Email Campaign", "Social Media", "Organic Search", "Paid Search",
  "Direct Mail", "Webinar", "Content Syndication", "Event",
];

const STATUSES = ["Open", "Contacted", "Qualified", "Unqualified", "Nurturing"];
const RATINGS = ["Hot", "Warm", "Cold"];
const TITLES = [
  "CEO", "CTO", "VP of Engineering", "Director of Sales", "Marketing Manager",
  "Product Manager", "Software Engineer", "Data Analyst", "Operations Director",
  "CFO", "Head of Growth", "IT Manager", "Account Executive", "VP of Marketing",
  "Chief Revenue Officer", "Solutions Architect",
];
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
  "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
];
const COUNTRIES = ["US", "US", "US", "US", "US", "CA", "GB", "AU", "DE", "FR"];

const REVENUES = [
  10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000,
  10_000_000, 50_000_000, 100_000_000, 500_000_000, 1_000_000_000, 10_000_000_000,
];

function generateRecord(index: number): Record<string, unknown> {
  const company = COMPANIES[index % COMPANIES.length]!;
  const firstName = FIRST_NAMES[index % FIRST_NAMES.length]!;
  const lastName = LAST_NAMES[(index * 7 + 3) % LAST_NAMES.length]!;
  const domain = company.toLowerCase().replace(/[\s.,']+/g, "").replace(/inc$|corp$|llc$/i, "");

  return {
    Id: `00Q${String(index).padStart(15, "0")}`,
    Name: `${firstName} ${lastName}`,
    FirstName: firstName,
    LastName: lastName,
    Email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@${domain}.com`,
    Phone: `+1${String(5550000000 + (index % 10_000_000)).padStart(10, "0")}`,
    Company: company,
    Industry: INDUSTRIES[index % INDUSTRIES.length]!,
    AnnualRevenue: REVENUES[index % REVENUES.length]!,
    NumberOfEmployees: (index % 50) * 100 + 10,
    State: STATES[index % STATES.length]!,
    Country: COUNTRIES[index % COUNTRIES.length]!,
    OwnerId: `005${String(index % 50).padStart(15, "0")}`,
    CreatedDate: new Date(Date.now() - (index % 365) * 86_400_000).toISOString(),
    LeadSource: LEAD_SOURCES[index % LEAD_SOURCES.length]!,
    Status: STATUSES[index % STATUSES.length]!,
    Title: TITLES[index % TITLES.length]!,
    Rating: RATINGS[index % RATINGS.length]!,
  };
}

// ─── Mock SFDC Connection ────────────────────────────────────────────────────

function createMockConnection(matchHitRate: number) {
  let queryCount = 0;

  return {
    query: async (soql: string) => {
      queryCount++;
      if (matchHitRate === 0) {
        return { totalSize: 0, done: true, records: [] };
      }
      const records: Array<{ Id: string; OwnerId: string; Email?: string; Phone?: string; Name?: string }> = [];
      const inMatch = soql.match(/IN \(([^)]+)\)/);
      if (inMatch) {
        const values = inMatch[1]!.split(",").map((v) => v.trim().replace(/'/g, ""));
        for (const val of values) {
          if (Math.random() * 100 < matchHitRate) {
            records.push({
              Id: `00Q${String(Math.floor(Math.random() * 1e15)).padStart(15, "0")}`,
              OwnerId: `005${String(Math.floor(Math.random() * 50)).padStart(15, "0")}`,
              Email: val.includes("@") ? val : undefined,
              Phone: /^\+?\d/.test(val) ? val : undefined,
              Name: val,
            });
          }
        }
      }
      return { totalSize: records.length, done: true, records };
    },
    queryMore: async () => ({ totalSize: 0, done: true, records: [] }),
    get queryCount() { return queryCount; },
  };
}

// ─── Simulated Condition Evaluation ──────────────────────────────────────────

interface SimCondition {
  fieldName: string;
  operator: string;
  value: string | null;
}

const SAMPLE_CONDITIONS: SimCondition[] = [
  { fieldName: "Industry", operator: "equals", value: "Technology" },
  { fieldName: "AnnualRevenue", operator: "gt", value: "1000000" },
  { fieldName: "State", operator: "not_equals", value: "CA" },
  { fieldName: "LeadSource", operator: "contains", value: "Web" },
  { fieldName: "Rating", operator: "equals", value: "Hot" },
  { fieldName: "NumberOfEmployees", operator: "gte", value: "100" },
  { fieldName: "Status", operator: "not_equals", value: "Unqualified" },
  { fieldName: "Country", operator: "equals", value: "US" },
];

function evalConditionSync(record: Record<string, unknown>, c: SimCondition): boolean {
  const raw = record[c.fieldName] ?? null;
  const { operator, value } = c;
  switch (operator) {
    case "equals": return String(raw ?? "") === String(value ?? "");
    case "not_equals": return String(raw ?? "") !== String(value ?? "");
    case "contains": return String(raw ?? "").toLowerCase().includes(String(value ?? "").toLowerCase());
    case "gt": return Number(raw) > Number(value);
    case "lt": return Number(raw) < Number(value);
    case "gte": return Number(raw) >= Number(value);
    case "lte": return Number(raw) <= Number(value);
    case "is_blank": return raw === null || raw === undefined || raw === "";
    case "is_not_blank": return raw !== null && raw !== undefined && raw !== "";
    default: return false;
  }
}

function simulateRouting(record: Record<string, unknown>): { matched: boolean; decisionTrace: string } {
  const results = SAMPLE_CONDITIONS.map((c) => ({
    field: c.fieldName,
    operator: c.operator,
    value: c.value,
    result: evalConditionSync(record, c),
  }));
  const matched = results.some((r) => r.result);
  const decisionTrace = JSON.stringify({
    recordId: record["Id"],
    ruleEvaluations: [{
      ruleId: "rule_sim_001",
      ruleName: "Enterprise Lead Routing",
      priority: 1,
      outcome: matched ? "MATCHED" : "UNMATCHED",
      conditions: results,
    }],
    assignee: matched
      ? { type: "ROUND_ROBIN", userId: `005${String(Math.floor(Math.random() * 50)).padStart(15, "0")}`, teamId: "team_001" }
      : null,
    timestamp: new Date().toISOString(),
  });
  return { matched, decisionTrace };
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

interface MemorySample { recordIndex: number; rss: number; heapUsed: number; }

interface Metrics {
  totalRecords: number;
  batchSize: number;
  totalBatches: number;
  batchTimesMs: number[];
  memorySamples: MemorySample[];
  matchQueryCount: number;
  recordsMatched: number;
  recordsRouted: number;
  totalTimeMs: number;
  peakRss: number;
  peakHeapUsed: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

function fmt(bytes: number): string { return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function fmtN(n: number): string { return n.toLocaleString("en-US"); }

// ─── Main Load Test (TRUE STREAMING) ─────────────────────────────────────────

async function runLoadTest() {
  const opts = parseArgs(process.argv);
  const { records: totalRecords, batchSize, withMatching, matchHitRate } = opts;
  const totalBatches = Math.ceil(totalRecords / batchSize);

  console.log("");
  console.log("  Lead Routing — Bulk Search Load Test (streaming mode)");
  console.log("  " + "─".repeat(50));
  console.log(`  Records:    ${fmtN(totalRecords)}`);
  console.log(`  Batch size: ${fmtN(batchSize)}`);
  console.log(`  Matching:   ${withMatching} (hit rate: ${matchHitRate}%)`);
  console.log("");

  const matchConfig: CachedMatchConfig = {
    checkLeads: true, checkContacts: true, checkAccounts: true,
    matchEmail: true, matchPhone: true, matchDomain: true,
    matchCompanyName: true, fuzzyMatchMode: "STRICT",
    onLeadMatch: "ASSIGN_OWNER", onContactMatch: "ASSIGN_OWNER", onAccountMatch: "ASSIGN_OWNER",
  };

  const mockConn = createMockConnection(matchHitRate);

  const metrics: Metrics = {
    totalRecords, batchSize, totalBatches,
    batchTimesMs: [], memorySamples: [],
    matchQueryCount: 0, recordsMatched: 0, recordsRouted: 0,
    totalTimeMs: 0, peakRss: 0, peakHeapUsed: 0,
  };

  // ── TRUE STREAMING: generate → buffer → process → discard ──
  // Never hold more than 1 batch in memory at a time.

  const startTime = performance.now();
  let buffer: Array<{ recordId: string; fields: Record<string, unknown> }> = [];
  let totalProcessed = 0;
  let batchIdx = 0;
  const progressEvery = Math.max(1, Math.floor(totalRecords / 10));

  for (let i = 0; i < totalRecords; i++) {
    // Generate one record (simulates receiving from Bulk API stream)
    const fields = generateRecord(i);
    buffer.push({ recordId: String(fields.Id), fields });

    // When buffer fills a micro-batch, process and discard
    if (buffer.length >= batchSize) {
      const batchStart = performance.now();

      // Batch matching
      if (withMatching) {
        const matchResults = await batchMatchRecords(mockConn as any, buffer, matchConfig);
        for (const [, result] of matchResults) {
          if (result !== null) metrics.recordsMatched++;
        }
      }

      // Routing simulation
      for (const rec of buffer) {
        const { matched } = simulateRouting(rec.fields);
        if (matched) metrics.recordsRouted++;
      }

      metrics.batchTimesMs.push(performance.now() - batchStart);

      // Discard — this is the key: memory stays flat
      buffer = [];
      totalProcessed += batchSize;
      batchIdx++;

      // Memory sample every 10 batches
      if (batchIdx % 10 === 0) {
        const mem = process.memoryUsage();
        metrics.memorySamples.push({ recordIndex: totalProcessed, rss: mem.rss, heapUsed: mem.heapUsed });
        metrics.peakRss = Math.max(metrics.peakRss, mem.rss);
        metrics.peakHeapUsed = Math.max(metrics.peakHeapUsed, mem.heapUsed);
      }

      // Progress every 10%
      if (totalProcessed % progressEvery < batchSize) {
        const pct = Math.round((totalProcessed / totalRecords) * 100);
        const elapsed = performance.now() - startTime;
        const rps = Math.round((totalProcessed / elapsed) * 1000);
        const mem = process.memoryUsage();
        process.stdout.write(
          `  [${String(pct).padStart(3)}%] ${fmtN(totalProcessed)} records | ${fmtN(rps)} rec/s | RSS: ${fmt(mem.rss)} | Heap: ${fmt(mem.heapUsed)}\n`
        );
      }
    }
  }

  // Flush remaining partial batch
  if (buffer.length > 0) {
    const batchStart = performance.now();
    if (withMatching) {
      const matchResults = await batchMatchRecords(mockConn as any, buffer, matchConfig);
      for (const [, result] of matchResults) {
        if (result !== null) metrics.recordsMatched++;
      }
    }
    for (const rec of buffer) {
      const { matched } = simulateRouting(rec.fields);
      if (matched) metrics.recordsRouted++;
    }
    metrics.batchTimesMs.push(performance.now() - batchStart);
    totalProcessed += buffer.length;
    buffer = [];
  }

  const totalTimeMs = performance.now() - startTime;
  metrics.totalTimeMs = totalTimeMs;
  metrics.matchQueryCount = mockConn.queryCount;

  // Final memory
  const finalMem = process.memoryUsage();
  metrics.peakRss = Math.max(metrics.peakRss, finalMem.rss);
  metrics.peakHeapUsed = Math.max(metrics.peakHeapUsed, finalMem.heapUsed);

  // ─── Report ────────────────────────────────────────────────────────────────

  const sorted = [...metrics.batchTimesMs].sort((a, b) => a - b);
  const avgBatch = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const rps = Math.round((totalRecords / totalTimeMs) * 1000);

  console.log("");
  console.log("═".repeat(55));
  console.log("  Lead Routing — Bulk Search Load Test Results");
  console.log("═".repeat(55));
  console.log("");
  console.log(`  Records:          ${fmtN(totalRecords)}`);
  console.log(`  Batch size:       ${fmtN(batchSize)}`);
  console.log(`  Total batches:    ${fmtN(metrics.batchTimesMs.length)}`);
  console.log("");
  console.log("  ── Timing " + "─".repeat(42));
  console.log(`  Total time:       ${(totalTimeMs / 1000).toFixed(1)}s`);
  console.log(`  Records/sec:      ${fmtN(rps)}`);
  console.log(`  Avg batch time:   ${avgBatch.toFixed(1)}ms`);
  console.log(`  P50 batch time:   ${p50.toFixed(1)}ms`);
  console.log(`  P95 batch time:   ${p95.toFixed(1)}ms`);
  console.log(`  P99 batch time:   ${p99.toFixed(1)}ms`);
  console.log("");
  console.log("  ── Memory " + "─".repeat(42));
  console.log(`  Peak RSS:         ${fmt(metrics.peakRss)}`);
  console.log(`  Peak Heap Used:   ${fmt(metrics.peakHeapUsed)}`);
  console.log(`  Final RSS:        ${fmt(finalMem.rss)}`);
  console.log(`  Final Heap:       ${fmt(finalMem.heapUsed)}`);
  console.log("");
  console.log("  ── Batch Matching " + "─".repeat(34));
  console.log(`  Total match queries:  ${fmtN(metrics.matchQueryCount)}`);
  console.log(`  Avg queries/batch:    ${withMatching ? (metrics.matchQueryCount / metrics.batchTimesMs.length).toFixed(1) : "N/A"}`);
  console.log(`  Records matched:      ${fmtN(metrics.recordsMatched)} (${((metrics.recordsMatched / totalRecords) * 100).toFixed(1)}%)`);
  console.log("");
  console.log("  ── Routing " + "─".repeat(41));
  console.log(`  Records routed:       ${fmtN(metrics.recordsRouted)} (${((metrics.recordsRouted / totalRecords) * 100).toFixed(1)}%)`);
  console.log("");

  // ── Verdicts ───────────────────────────────────────────────────────────────

  console.log("  ── Verdict " + "─".repeat(41));

  const verdicts: Array<{ pass: boolean; label: string }> = [];

  // Memory stability: peak vs final
  const memGrowth = metrics.peakHeapUsed / (metrics.memorySamples[0]?.heapUsed || metrics.peakHeapUsed);
  verdicts.push({
    pass: memGrowth < 2.0,
    label: `Memory stable (growth ratio: ${memGrowth.toFixed(2)}x, peak: ${fmt(metrics.peakHeapUsed)})`,
  });

  verdicts.push({
    pass: rps > 10_000,
    label: `Throughput > 10,000 rec/s (actual: ${fmtN(rps)})`,
  });

  verdicts.push({
    pass: p99 < 100,
    label: `P99 batch time < 100ms (actual: ${p99.toFixed(1)}ms)`,
  });

  verdicts.push({
    pass: p95 < 50,
    label: `P95 batch time < 50ms (actual: ${p95.toFixed(1)}ms)`,
  });

  // At 10M+ records, memory should stay under 512MB heap
  if (totalRecords >= 1_000_000) {
    verdicts.push({
      pass: metrics.peakHeapUsed < 512 * 1024 * 1024,
      label: `Peak heap < 512 MB for ${fmtN(totalRecords)} records (actual: ${fmt(metrics.peakHeapUsed)})`,
    });
  }

  let allPass = true;
  for (const v of verdicts) {
    console.log(`  [${v.pass ? "PASS" : "FAIL"}] ${v.label}`);
    if (!v.pass) allPass = false;
  }

  console.log("");
  console.log("═".repeat(55));

  // ── Production warnings ────────────────────────────────────────────────────

  if (totalRecords >= 1_000_000) {
    console.log("");
    console.log("  ── Production Considerations ──────────────────────");
    console.log(`  SFDC API calls (batch matching): ~${fmtN(metrics.matchQueryCount)}`);
    console.log(`  SFDC daily API limit (Enterprise): ~100,000`);
    if (metrics.matchQueryCount > 100_000) {
      console.log(`  ⚠ Match queries (${fmtN(metrics.matchQueryCount)}) exceed daily limit!`);
      console.log(`    → Disable match step for large searches, or use larger batch size`);
    }
    const estRealTime = totalRecords / 30; // 30 records/sec with real SFDC latency
    console.log(`  Estimated real-world time (with SFDC latency): ~${(estRealTime / 60).toFixed(0)} minutes`);
    console.log(`  Estimated BullMQ jobs: ${fmtN(metrics.batchTimesMs.length)}`);
    console.log(`  Redis memory per job (~2KB): ~${fmt(metrics.batchTimesMs.length * 2048)}`);
    console.log("");
  }

  process.exit(allPass ? 0 : 1);
}

runLoadTest().catch((err) => {
  console.error("Load test failed:", err);
  process.exit(1);
});
