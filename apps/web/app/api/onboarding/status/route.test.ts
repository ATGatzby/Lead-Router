import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetOrgIdFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  organization: { findUnique: vi.fn() },
  user: { count: vi.fn() },
  fieldSchema: { count: vi.fn() },
  routingRule: { count: vi.fn() },
}));

vi.mock("@/lib/auth", () => ({ getOrgIdFromHeaders: mockGetOrgIdFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));

import { GET } from "./route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest() {
  return new Request("http://localhost/api/onboarding/status") as any;
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgIdFromHeaders.mockResolvedValue("org-1");
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("GET /api/onboarding/status", () => {
  it("returns 5 checklist items with correct labels and hrefs", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      sfdcOrgId: "00D123",
      packageDeployedAt: new Date(),
    });
    mockPrisma.user.count.mockResolvedValue(3);
    mockPrisma.fieldSchema.count.mockResolvedValue(10);
    mockPrisma.routingRule.count.mockResolvedValue(1);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.total).toBe(5);
    expect(body.completedCount).toBe(5);
    expect(body.items).toEqual([
      { id: "connect", label: "Connect CRM", href: "/integrations", done: true },
      { id: "deploy", label: "Deploy Package", href: "/integrations/salesforce", done: true },
      { id: "sync", label: "Sync Fields", href: "/integrations/salesforce", done: true },
      { id: "license", label: "License Users", href: "/license-users", done: true },
      { id: "rule", label: "Create Routing Rule", href: "/routing-rules", done: true },
    ]);
  });

  it("marks items as not done when conditions are not met", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      sfdcOrgId: null,
      packageDeployedAt: null,
    });
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.fieldSchema.count.mockResolvedValue(0);
    mockPrisma.routingRule.count.mockResolvedValue(0);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.completedCount).toBe(0);
    expect(body.items.every((i: any) => !i.done)).toBe(true);
  });

  it("marks deploy done independently of CRM connect", async () => {
    // Edge case: CRM connected but package not deployed
    mockPrisma.organization.findUnique.mockResolvedValue({
      sfdcOrgId: "00D123",
      packageDeployedAt: null,
    });
    mockPrisma.user.count.mockResolvedValue(0);
    mockPrisma.fieldSchema.count.mockResolvedValue(0);
    mockPrisma.routingRule.count.mockResolvedValue(0);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(body.completedCount).toBe(1); // only "connect" is done
    const connectItem = body.items.find((i: any) => i.id === "connect");
    const deployItem = body.items.find((i: any) => i.id === "deploy");
    expect(connectItem.done).toBe(true);
    expect(deployItem.done).toBe(false);
  });

  it("returns 500 on auth error", async () => {
    mockGetOrgIdFromHeaders.mockRejectedValue(new Error("Unauthenticated"));

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
  });
});
