/**
 * k6 Load Test — Lead Routing Engine
 *
 * Tests the POST /route webhook endpoint under sustained load.
 *
 * Usage:
 *   k6 run load-test/routing-load-test.js \
 *     -e ENGINE_URL=http://localhost:4000 \
 *     -e ORG_ID=<your-org-id> \
 *     -e WEBHOOK_SECRET=<your-webhook-secret>
 *
 * Install k6: https://k6.io/docs/get-started/installation/
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import crypto from "k6/crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

const ENGINE_URL = __ENV.ENGINE_URL || "http://localhost:4000";
const ORG_ID = __ENV.ORG_ID || "test-org-id";
const WEBHOOK_SECRET = __ENV.WEBHOOK_SECRET || "test-secret-change-me";

// ─── Custom metrics ───────────────────────────────────────────────────────────

const errorRate = new Rate("routing_errors");
const routingDuration = new Trend("routing_duration_ms", true);

// ─── Test options ─────────────────────────────────────────────────────────────

export const options = {
  stages: [
    { duration: "15s", target: 50 },   // ramp up to 50 VUs
    { duration: "30s", target: 500 },  // ramp up to 500 VUs
    { duration: "60s", target: 500 },  // hold 500 VUs for 1 minute
    { duration: "15s", target: 0 },    // ramp down
  ],
  thresholds: {
    // p95 response time must be below 5s
    http_req_duration: ["p(95)<5000"],
    // Error rate must stay below 1%
    routing_errors: ["rate<0.01"],
    // Custom routing duration p95 < 5s
    routing_duration_ms: ["p(95)<5000"],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const OBJECT_TYPES = ["LEAD", "CONTACT", "ACCOUNT"];
const EVENT_TYPES = ["INSERT", "UPDATE"];
const LEAD_SOURCES = ["Web", "Phone", "Partner", "Employee Referral", "Trade Show", "Other"];
const INDUSTRIES = ["Technology", "Finance", "Healthcare", "Manufacturing", "Retail"];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPayload() {
  const objectType = randomItem(OBJECT_TYPES);
  const eventType = randomItem(EVENT_TYPES);
  const recordId = "00Q" + Math.random().toString(36).substr(2, 12).toUpperCase();

  const fields = {
    LeadSource: randomItem(LEAD_SOURCES),
    Industry: randomItem(INDUSTRIES),
    AnnualRevenue: Math.floor(Math.random() * 10_000_000),
    NumberOfEmployees: Math.floor(Math.random() * 5000),
    Country: randomItem(["India", "USA", "UK", "Singapore", "Australia"]),
    Rating: randomItem(["Hot", "Warm", "Cold", ""]),
    Status: randomItem(["Open - Not Contacted", "Working", "Closed - Converted"]),
  };

  return {
    orgId: ORG_ID,
    objectType,
    eventType,
    recordId,
    timestamp: new Date().toISOString(),
    fields,
  };
}

function sign(payload, secret) {
  const hmac = crypto.createHMAC("sha256", secret);
  hmac.update(payload);
  return "sha256=" + hmac.digest("hex");
}

// ─── Virtual User ─────────────────────────────────────────────────────────────

export default function () {
  const payload = JSON.stringify(buildPayload());
  const signature = sign(payload, WEBHOOK_SECRET);

  const start = Date.now();

  const res = http.post(`${ENGINE_URL}/route`, payload, {
    headers: {
      "Content-Type": "application/json",
      "X-Sfdc-Org-Id": ORG_ID,
      "X-Signature-256": signature,
    },
    timeout: "10s",
  });

  const elapsed = Date.now() - start;
  routingDuration.add(elapsed);

  const ok = check(res, {
    "status 200 or 202": (r) => r.status === 200 || r.status === 202,
    "response has result": (r) => {
      try {
        const body = JSON.parse(r.body);
        return "result" in body;
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);

  // Small think time — realistic inter-request pause
  sleep(Math.random() * 0.5);
}

// ─── Teardown ─────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  return {
    stdout: `
=== Routing Engine Load Test Summary ===
Total requests    : ${data.metrics.http_reqs.values.count}
Failed requests   : ${Math.round(data.metrics.routing_errors.values.rate * data.metrics.http_reqs.values.count)}
Error rate        : ${(data.metrics.routing_errors.values.rate * 100).toFixed(2)}%
Avg duration      : ${data.metrics.http_req_duration.values.avg.toFixed(0)}ms
p50 duration      : ${data.metrics.http_req_duration.values["p(50)"].toFixed(0)}ms
p95 duration      : ${data.metrics.http_req_duration.values["p(95)"].toFixed(0)}ms
p99 duration      : ${data.metrics.http_req_duration.values["p(99)"].toFixed(0)}ms
Max duration      : ${data.metrics.http_req_duration.values.max.toFixed(0)}ms
Req/s (peak)      : ${data.metrics.http_reqs.values.rate.toFixed(1)}
`,
  };
}
