import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";

import {
  setupTeamInput,
  setupRuleInput,
  syncCrmSchemaInput,
  importUsersInput,
  routeRecordInput,
  bulkRouteInput,
  retryFailedInput,
  toggleRoutingInput,
  rebalanceTeamInput,
  updateRuleCriteriaInput,
  reorderRulesInput,
  cloneAndModifyRuleInput,
  getPerformanceInput,
  getTeamWorkloadInput,
  exportReportInput,
} from "./schemas/inputs";

import {
  setupTeamResponse,
  setupRuleResponse,
  syncCrmSchemaResponse,
  importUsersResponse,
  routeRecordResponse,
  bulkRouteResponse,
  retryFailedResponse,
  toggleRoutingResponse,
  rebalanceTeamResponse,
  updateRuleCriteriaResponse,
  reorderRulesResponse,
  cloneAndModifyRuleResponse,
  getRoutingStatusResponse,
  getPerformanceResponse,
  getTeamWorkloadResponse,
  exportReportResponse,
} from "./schemas/responses";

// ─── Helpers ────────────────────────────────────────────────────────────────

function toJsonSchema(schema: ZodTypeAny) {
  return zodToJsonSchema(schema, { target: "openApi3" });
}

function wrapEnvelope(dataSchema: ReturnType<typeof toJsonSchema>) {
  return {
    type: "object" as const,
    properties: {
      ok: { type: "boolean" as const, example: true },
      data: dataSchema,
    },
    required: ["ok", "data"],
  };
}

function errorEnvelope() {
  return {
    type: "object" as const,
    properties: {
      ok: { type: "boolean" as const, example: false },
      error: { type: "string" as const },
      code: { type: "string" as const },
    },
    required: ["ok", "error"],
  };
}

function postPath(
  tag: string,
  summary: string,
  description: string,
  inputSchema: ZodTypeAny,
  responseSchema: ZodTypeAny,
) {
  return {
    post: {
      tags: [tag],
      summary,
      description,
      security: [{ BearerAuth: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: toJsonSchema(inputSchema),
          },
        },
      },
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: wrapEnvelope(toJsonSchema(responseSchema)),
            },
          },
        },
        "400": {
          description: "Validation error",
          content: {
            "application/json": { schema: errorEnvelope() },
          },
        },
        "401": {
          description: "Unauthorized",
          content: {
            "application/json": { schema: errorEnvelope() },
          },
        },
      },
    },
  };
}

function getPath(
  tag: string,
  summary: string,
  description: string,
  responseSchema: ZodTypeAny,
  parameters?: Array<Record<string, unknown>>,
) {
  return {
    get: {
      tags: [tag],
      summary,
      description,
      security: [{ BearerAuth: [] }],
      ...(parameters && parameters.length > 0 ? { parameters } : {}),
      responses: {
        "200": {
          description: "Successful response",
          content: {
            "application/json": {
              schema: wrapEnvelope(toJsonSchema(responseSchema)),
            },
          },
        },
        "401": {
          description: "Unauthorized",
          content: {
            "application/json": { schema: errorEnvelope() },
          },
        },
      },
    },
  };
}

// ─── Generator ──────────────────────────────────────────────────────────────

export function generateOpenAPISpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Lead Routing Agent API",
      version: "1.0.0",
      description:
        "REST API for programmatic lead routing operations. Supports setup, routing, optimization, and monitoring actions.",
    },
    servers: [{ url: "/", description: "Current host" }],
    security: [{ BearerAuth: [] }],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API Key",
          description: "Org-level API key passed as a Bearer token.",
        },
      },
    },
    tags: [
      { name: "Setup", description: "Configure teams, rules, CRM schema, and users" },
      { name: "Operations", description: "Route records and manage routing operations" },
      { name: "Optimize", description: "Rebalance teams, update criteria, reorder rules" },
      { name: "Monitor", description: "Check status, performance, workload, and export reports" },
    ],
    paths: {
      // ── Setup ───────────────────────────────────────────────────────────
      "/api/v1/actions/setup-team": postPath(
        "Setup",
        "Set up a team",
        "Create or update a routing team with members and distribution strategy.",
        setupTeamInput,
        setupTeamResponse,
      ),
      "/api/v1/actions/setup-routing-rule": postPath(
        "Setup",
        "Set up a routing rule",
        "Create a routing rule with object type, trigger event, criteria, and assignment target.",
        setupRuleInput,
        setupRuleResponse,
      ),
      "/api/v1/actions/sync-crm-schema": postPath(
        "Setup",
        "Sync CRM schema",
        "Synchronize object fields and queues from the connected CRM.",
        syncCrmSchemaInput,
        syncCrmSchemaResponse,
      ),
      "/api/v1/actions/import-users": postPath(
        "Setup",
        "Import users",
        "Import users from the connected CRM and optionally auto-license them.",
        importUsersInput,
        importUsersResponse,
      ),

      // ── Operations ──────────────────────────────────────────────────────
      "/api/v1/actions/route-record": postPath(
        "Operations",
        "Route a single record",
        "Route a single CRM record through the matching rules and assign it.",
        routeRecordInput,
        routeRecordResponse,
      ),
      "/api/v1/actions/bulk-route": postPath(
        "Operations",
        "Bulk route records",
        "Submit a batch of records for routing. Returns a batch ID for tracking.",
        bulkRouteInput,
        bulkRouteResponse,
      ),
      "/api/v1/actions/retry-failed": postPath(
        "Operations",
        "Retry failed records",
        "Re-attempt routing for previously failed records within a date range.",
        retryFailedInput,
        retryFailedResponse,
      ),
      "/api/v1/actions/toggle-routing": postPath(
        "Operations",
        "Toggle routing mode",
        "Switch routing mode (CLASSIC or FLOW) for an object type.",
        toggleRoutingInput,
        toggleRoutingResponse,
      ),

      // ── Optimize ────────────────────────────────────────────────────────
      "/api/v1/actions/rebalance-team": postPath(
        "Optimize",
        "Rebalance team",
        "Rebalance member weights within a team using equalize or proportional strategy.",
        rebalanceTeamInput,
        rebalanceTeamResponse,
      ),
      "/api/v1/actions/update-rule-criteria": postPath(
        "Optimize",
        "Update rule criteria",
        "Replace the filter criteria on an existing routing rule.",
        updateRuleCriteriaInput,
        updateRuleCriteriaResponse,
      ),
      "/api/v1/actions/reorder-rules": postPath(
        "Optimize",
        "Reorder rules",
        "Set the evaluation priority order for rules of a given object type.",
        reorderRulesInput,
        reorderRulesResponse,
      ),
      "/api/v1/actions/clone-and-modify-rule": postPath(
        "Optimize",
        "Clone and modify rule",
        "Duplicate an existing rule and optionally apply modifications to the clone.",
        cloneAndModifyRuleInput,
        cloneAndModifyRuleResponse,
      ),

      // ── Monitor ─────────────────────────────────────────────────────────
      "/api/v1/actions/get-routing-status": getPath(
        "Monitor",
        "Get routing status",
        "Retrieve the current routing configuration status including CRM connection, active rules, and team counts.",
        getRoutingStatusResponse,
      ),
      "/api/v1/actions/get-performance": getPath(
        "Monitor",
        "Get performance metrics",
        "Retrieve routing performance metrics for a given date range, optionally filtered by rule or team.",
        getPerformanceResponse,
        [
          { name: "fromDate", in: "query", schema: { type: "string", format: "date-time" }, description: "Start of date range (ISO 8601)" },
          { name: "toDate", in: "query", schema: { type: "string", format: "date-time" }, description: "End of date range (ISO 8601)" },
          { name: "ruleId", in: "query", schema: { type: "string" }, description: "Filter by rule ID" },
          { name: "teamId", in: "query", schema: { type: "string" }, description: "Filter by team ID" },
        ],
      ),
      "/api/v1/actions/get-team-workload": getPath(
        "Monitor",
        "Get team workload",
        "Retrieve workload distribution across teams and their members.",
        getTeamWorkloadResponse,
        [
          { name: "teamId", in: "query", schema: { type: "string" }, description: "Filter by team ID" },
          { name: "fromDate", in: "query", schema: { type: "string", format: "date-time" }, description: "Start of date range (ISO 8601)" },
          { name: "toDate", in: "query", schema: { type: "string", format: "date-time" }, description: "End of date range (ISO 8601)" },
        ],
      ),
      "/api/v1/actions/export-report": postPath(
        "Monitor",
        "Export report",
        "Export routing logs as CSV or JSON for a given date range and optional filters.",
        exportReportInput,
        exportReportResponse,
      ),
    },
  };
}
