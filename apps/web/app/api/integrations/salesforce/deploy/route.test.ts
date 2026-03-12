import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ───────────────────────────────────────────────────────────

const mockGetOrgIdFromHeaders = vi.hoisted(() => vi.fn());
const mockPrisma = vi.hoisted(() => ({
  organization: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));
const mockDeployMetadata = vi.hoisted(() => vi.fn());
const mockWaitForDeploy = vi.hoisted(() => vi.fn());
const mockQuery = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockSfUpdate = vi.hoisted(() => vi.fn());
const mockGetCurrentUserId = vi.hoisted(() => vi.fn());
const mockZipSourcePackage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({ getOrgIdFromHeaders: mockGetOrgIdFromHeaders }));
vi.mock("@lead-routing/db", () => ({ prisma: mockPrisma }));
vi.mock("@lead-routing/sfdc", () => ({
  SalesforceApi: vi.fn().mockImplementation(() => ({
    deployMetadata: mockDeployMetadata,
    waitForDeploy: mockWaitForDeploy,
    query: mockQuery,
    create: mockCreate,
    update: mockSfUpdate,
    getCurrentUserId: mockGetCurrentUserId,
  })),
  DuplicateError: class DuplicateError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "DuplicateError";
    }
  },
  zipSourcePackage: mockZipSourcePackage,
}));

// Mock fs operations
const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockWriteFileSync = vi.hoisted(() => vi.fn());
const mockCpSync = vi.hoisted(() => vi.fn());
const mockRmSync = vi.hoisted(() => vi.fn());

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  cpSync: mockCpSync,
  rmSync: mockRmSync,
}));

vi.mock("node:os", () => ({
  tmpdir: () => "/tmp",
}));

import { POST } from "./route";

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgIdFromHeaders.mockResolvedValue("org-1");
  // By default, Docker path exists
  mockExistsSync.mockImplementation((p: string) => {
    if (p.endsWith("sfdc-package") && !p.includes("apps/cli")) return true;
    return false;
  });
  mockReadFileSync.mockReturnValue("<xml><endpoint>PLACEHOLDER</endpoint></xml>");
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function parseJson(res: Response) {
  return res.json();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/integrations/salesforce/deploy", () => {
  it("returns 404 when org not found", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null);

    const res = await POST();
    const body = await parseJson(res);

    expect(res.status).toBe(404);
    expect(body.error).toBe("Organization not found");
  });

  it("returns 400 when SFDC is not connected", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: "org-1",
      oauthAccessToken: null,
      sfdcInstanceUrl: null,
      webhookSecret: "secret123",
    });

    const res = await POST();
    const body = await parseJson(res);

    expect(res.status).toBe(400);
    expect(body.error).toContain("not connected");
  });

  it("returns 422 when deploy fails", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: "org-1",
      oauthAccessToken: "token",
      sfdcInstanceUrl: "https://test.salesforce.com",
      webhookSecret: "secret123",
    });
    mockZipSourcePackage.mockResolvedValue(Buffer.from("zip"));
    mockDeployMetadata.mockResolvedValue("deploy-1");
    mockWaitForDeploy.mockResolvedValue({
      success: false,
      numberComponentErrors: 2,
      errorMessage: "Bad metadata",
      details: { componentFailures: [] },
    });

    const res = await POST();
    const body = await parseJson(res);

    expect(res.status).toBe(422);
    expect(body.error).toBe("Metadata deploy failed");
  });

  it("deploys successfully and updates org record", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: "org-1",
      oauthAccessToken: "token",
      sfdcInstanceUrl: "https://test.salesforce.com",
      webhookSecret: "secret123",
    });
    mockZipSourcePackage.mockResolvedValue(Buffer.from("zip"));
    mockDeployMetadata.mockResolvedValue("deploy-1");
    mockWaitForDeploy.mockResolvedValue({
      success: true,
      numberComponentsDeployed: 10,
    });
    mockQuery.mockResolvedValueOnce([{ Id: "perm-1" }]); // permission set
    mockGetCurrentUserId.mockResolvedValue("user-1");
    mockCreate.mockResolvedValue("assignment-1");
    mockQuery.mockResolvedValueOnce([{ Id: "settings-1" }]); // existing settings
    mockSfUpdate.mockResolvedValue(undefined);
    mockPrisma.organization.update.mockResolvedValue({});

    const res = await POST();
    const body = await parseJson(res);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.componentsDeployed).toBe(10);
    expect(body.permSetAssigned).toBe(true);
    expect(body.settingsWritten).toBe(true);

    // Verify org was updated with deploy info
    expect(mockPrisma.organization.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: {
        packageDeployedAt: expect.any(Date),
        packageDeployId: "deploy-1",
        packageVersion: "1.0.0",
      },
    });
  });

  it("returns 500 when auth fails", async () => {
    mockGetOrgIdFromHeaders.mockRejectedValue(new Error("Missing x-org-id header"));

    const res = await POST();
    const body = await parseJson(res);

    expect(res.status).toBe(500);
    expect(body.error).toBe("Missing x-org-id header");
  });
});
