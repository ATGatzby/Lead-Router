import { describe, it, expect } from "vitest";
import { generateOpenAPISpec } from "../src/openapi.js";

describe("generateOpenAPISpec", () => {
  const spec = generateOpenAPISpec();

  it("returns a valid OpenAPI 3.1 version", () => {
    expect(spec.openapi).toBe("3.1.0");
  });

  it("has correct info metadata", () => {
    expect(spec.info.title).toBe("Lead Routing Agent API");
    expect(spec.info.version).toBe("1.0.0");
  });

  it("defines BearerAuth security scheme", () => {
    expect(spec.components.securitySchemes.BearerAuth).toBeDefined();
    expect(spec.components.securitySchemes.BearerAuth.type).toBe("http");
    expect(spec.components.securitySchemes.BearerAuth.scheme).toBe("bearer");
  });

  it("defines all 4 tags", () => {
    const tagNames = spec.tags.map((t) => t.name);
    expect(tagNames).toEqual(["Setup", "Operations", "Optimize", "Monitor"]);
  });

  it("has all 16 action endpoints", () => {
    const paths = Object.keys(spec.paths);
    expect(paths).toHaveLength(16);
  });

  it("maps Setup endpoints correctly", () => {
    const setupPaths = [
      "/api/v1/actions/setup-team",
      "/api/v1/actions/setup-routing-rule",
      "/api/v1/actions/sync-crm-schema",
      "/api/v1/actions/import-users",
    ];
    for (const path of setupPaths) {
      const op = (spec.paths as Record<string, Record<string, { tags: string[] }>>)[path];
      expect(op).toBeDefined();
      const method = op.post || op.get;
      expect(method.tags).toContain("Setup");
    }
  });

  it("maps Operations endpoints correctly", () => {
    const opsPaths = [
      "/api/v1/actions/route-record",
      "/api/v1/actions/bulk-route",
      "/api/v1/actions/retry-failed",
      "/api/v1/actions/toggle-routing",
    ];
    for (const path of opsPaths) {
      const op = (spec.paths as Record<string, Record<string, { tags: string[] }>>)[path];
      expect(op).toBeDefined();
      const method = op.post || op.get;
      expect(method.tags).toContain("Operations");
    }
  });

  it("maps Optimize endpoints correctly", () => {
    const optPaths = [
      "/api/v1/actions/rebalance-team",
      "/api/v1/actions/update-rule-criteria",
      "/api/v1/actions/reorder-rules",
      "/api/v1/actions/clone-and-modify-rule",
    ];
    for (const path of optPaths) {
      const op = (spec.paths as Record<string, Record<string, { tags: string[] }>>)[path];
      expect(op).toBeDefined();
      const method = op.post || op.get;
      expect(method.tags).toContain("Optimize");
    }
  });

  it("maps Monitor endpoints correctly", () => {
    const monPaths = [
      "/api/v1/actions/get-routing-status",
      "/api/v1/actions/get-performance",
      "/api/v1/actions/get-team-workload",
      "/api/v1/actions/export-report",
    ];
    for (const path of monPaths) {
      const op = (spec.paths as Record<string, Record<string, { tags: string[] }>>)[path];
      expect(op).toBeDefined();
      const method = op.post || op.get;
      expect(method.tags).toContain("Monitor");
    }
  });

  it("uses GET for monitor read endpoints", () => {
    const p = spec.paths as Record<string, Record<string, unknown>>;
    expect(p["/api/v1/actions/get-routing-status"]).toHaveProperty("get");
    expect(p["/api/v1/actions/get-performance"]).toHaveProperty("get");
    expect(p["/api/v1/actions/get-team-workload"]).toHaveProperty("get");
  });

  it("uses POST for action endpoints", () => {
    const p = spec.paths as Record<string, Record<string, unknown>>;
    expect(p["/api/v1/actions/setup-team"]).toHaveProperty("post");
    expect(p["/api/v1/actions/route-record"]).toHaveProperty("post");
    expect(p["/api/v1/actions/export-report"]).toHaveProperty("post");
  });

  it("wraps 200 responses in AgentResponse envelope", () => {
    const p = spec.paths as Record<string, Record<string, { responses: Record<string, { content: Record<string, { schema: Record<string, unknown> }> }> }>>;
    const schema = p["/api/v1/actions/setup-team"].post.responses["200"].content["application/json"].schema as Record<string, unknown>;
    expect(schema).toHaveProperty("properties");
    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("ok");
    expect(props).toHaveProperty("data");
  });

  it("includes security on each operation", () => {
    for (const [, pathItem] of Object.entries(spec.paths)) {
      const op = (pathItem as Record<string, { security?: unknown[] }>).post ||
        (pathItem as Record<string, { security?: unknown[] }>).get;
      expect(op?.security).toBeDefined();
      expect(op?.security).toEqual([{ BearerAuth: [] }]);
    }
  });

  it("includes query parameters on GET performance endpoint", () => {
    const p = spec.paths as Record<string, Record<string, { parameters?: Array<{ name: string }> }>>;
    const params = p["/api/v1/actions/get-performance"].get.parameters;
    expect(params).toBeDefined();
    expect(params!.map((p) => p.name)).toEqual(["fromDate", "toDate", "ruleId", "teamId"]);
  });
});
