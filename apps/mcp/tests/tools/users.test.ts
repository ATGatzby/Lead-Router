import { describe, it, expect, vi } from "vitest";
import { mockWebClient, mockLogger } from "../helpers";
import { handleListUsers } from "../../src/tools/list-users.js";
import { handleSyncUsers } from "../../src/tools/sync-users.js";
import { handleUpdateUserLicense } from "../../src/tools/update-user-license.js";
import { handleBulkLicenseUsers } from "../../src/tools/bulk-license-users.js";
import { handleLicenseUsersByRole } from "../../src/tools/license-users-by-role.js";
import { handleLicenseUsersByProfile } from "../../src/tools/license-users-by-profile.js";
import { handleGetUserStats } from "../../src/tools/get-user-stats.js";

// ---------------------------------------------------------------------------
// list_users
// ---------------------------------------------------------------------------
describe("handleListUsers", () => {
  it("returns formatted user list", async () => {
    const web = mockWebClient({
      listUsers: vi.fn().mockResolvedValue({
        users: [{ id: "u1", name: "Alice", email: "alice@test.com", isLicensed: true }],
      }),
    });
    const res = await handleListUsers(web, mockLogger(), {});
    expect(res.content[0].text).toContain("Alice");
  });

  it("returns empty message", async () => {
    const web = mockWebClient({ listUsers: vi.fn().mockResolvedValue({ users: [] }) });
    const res = await handleListUsers(web, mockLogger(), {});
    expect(res.content[0].text).toContain("No users");
  });
});

// ---------------------------------------------------------------------------
// sync_users
// ---------------------------------------------------------------------------
describe("handleSyncUsers", () => {
  it("reports sync results", async () => {
    const web = mockWebClient({
      syncUsers: vi.fn().mockResolvedValue({ upserted: 10, deactivated: 2, total: 50 }),
    });
    const res = await handleSyncUsers(web, mockLogger());
    expect(res.content[0].text).toContain("sync completed");
    expect(res.content[0].text).toContain("10");
  });
});

// ---------------------------------------------------------------------------
// update_user_license
// ---------------------------------------------------------------------------
describe("handleUpdateUserLicense", () => {
  it("returns preview for licensing", async () => {
    const web = mockWebClient();
    const res = await handleUpdateUserLicense(web, mockLogger(), { userId: "u1", licensed: true });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("LICENSE");
  });

  it("returns preview for unlicensing", async () => {
    const web = mockWebClient();
    const res = await handleUpdateUserLicense(web, mockLogger(), { userId: "u1", licensed: false });
    expect(res.content[0].text).toContain("UNLICENSE");
  });

  it("licenses user when confirmed", async () => {
    const web = mockWebClient({
      licenseUser: vi.fn().mockResolvedValue({ seatsUsed: 5 }),
    });
    const res = await handleUpdateUserLicense(web, mockLogger(), { userId: "u1", licensed: true, confirm: true });
    expect(res.content[0].text).toContain("licensed");
    expect(web.licenseUser).toHaveBeenCalledWith("u1");
  });

  it("unlicenses user when confirmed", async () => {
    const web = mockWebClient({
      delicenseUser: vi.fn().mockResolvedValue({ removedFromTeams: ["Sales"] }),
    });
    const res = await handleUpdateUserLicense(web, mockLogger(), { userId: "u1", licensed: false, confirm: true });
    expect(res.content[0].text).toContain("unlicensed");
    expect(res.content[0].text).toContain("Sales");
  });
});

// ---------------------------------------------------------------------------
// bulk_license_users
// ---------------------------------------------------------------------------
describe("handleBulkLicenseUsers", () => {
  it("returns preview with user count", async () => {
    const web = mockWebClient();
    const res = await handleBulkLicenseUsers(web, mockLogger(), { userIds: ["u1", "u2", "u3"] });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("3 user(s)");
  });

  it("bulk licenses when confirmed", async () => {
    const web = mockWebClient({
      bulkLicenseUsers: vi.fn().mockResolvedValue({ licensed: 2 }),
    });
    const res = await handleBulkLicenseUsers(web, mockLogger(), { userIds: ["u1", "u2"], confirm: true });
    expect(res.content[0].text).toContain("licensed");
    expect(web.bulkLicenseUsers).toHaveBeenCalledWith(["u1", "u2"]);
  });
});

// ---------------------------------------------------------------------------
// license_users_by_role
// ---------------------------------------------------------------------------
describe("handleLicenseUsersByRole", () => {
  it("returns preview", async () => {
    const web = mockWebClient();
    const res = await handleLicenseUsersByRole(web, mockLogger(), { role: "Sales Rep" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Sales Rep");
  });

  it("licenses by role when confirmed", async () => {
    const web = mockWebClient({
      licenseUsersByRole: vi.fn().mockResolvedValue({ licensed: 5 }),
    });
    const res = await handleLicenseUsersByRole(web, mockLogger(), { role: "Sales Rep", confirm: true });
    expect(res.content[0].text).toContain("Sales Rep");
    expect(res.content[0].text).toContain("5");
  });
});

// ---------------------------------------------------------------------------
// license_users_by_profile
// ---------------------------------------------------------------------------
describe("handleLicenseUsersByProfile", () => {
  it("returns preview", async () => {
    const web = mockWebClient();
    const res = await handleLicenseUsersByProfile(web, mockLogger(), { profile: "Standard User" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Standard User");
  });

  it("licenses by profile when confirmed", async () => {
    const web = mockWebClient({
      licenseUsersByProfile: vi.fn().mockResolvedValue({ licensed: 4 }),
    });
    const res = await handleLicenseUsersByProfile(web, mockLogger(), { profile: "Standard User", confirm: true });
    expect(res.content[0].text).toContain("Standard User");
    expect(res.content[0].text).toContain("4");
  });
});

// ---------------------------------------------------------------------------
// get_user_stats
// ---------------------------------------------------------------------------
describe("handleGetUserStats", () => {
  it("returns user statistics", async () => {
    const web = mockWebClient({
      getUserStats: vi.fn().mockResolvedValue({
        seatsPurchased: 25,
        seatsUsed: 20,
        breakdown: { individual: 15, byRole: 3, byProfile: 2, byCustomField: 0, licensedQueues: 0 },
      }),
    });
    const res = await handleGetUserStats(web, mockLogger());
    expect(res.content[0].text).toContain("20");
    expect(res.content[0].text).toContain("25");
  });
});
