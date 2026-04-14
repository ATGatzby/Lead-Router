import { describe, it, expect, vi } from "vitest";
import { mockWebClient, mockLogger } from "../helpers";
import { handleAddTeamMember } from "../../src/tools/add-team-member.js";
import { handleRemoveTeamMember } from "../../src/tools/remove-team-member.js";
import { handleToggleTeamMember } from "../../src/tools/toggle-team-member.js";
import { handleUpdateTeamWeights } from "../../src/tools/update-team-weights.js";
import { handleResetTeamPointer } from "../../src/tools/reset-team-pointer.js";

// ---------------------------------------------------------------------------
// add_team_member
// ---------------------------------------------------------------------------
describe("handleAddTeamMember", () => {
  it("returns preview", async () => {
    const web = mockWebClient({
      getTeam: vi.fn().mockResolvedValue({ name: "Sales" }),
    });
    const res = await handleAddTeamMember(web, mockLogger(), { teamId: "t1", userId: "u1" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Sales");
    expect(res.content[0].text).toContain("u1");
  });

  it("adds member when confirmed", async () => {
    const web = mockWebClient();
    const res = await handleAddTeamMember(web, mockLogger(), { teamId: "t1", userId: "u1", confirm: true });
    expect(res.content[0].text).toContain("added");
    expect(web.addTeamMember).toHaveBeenCalledWith("t1", { userIds: ["u1"] });
  });

  it("includes weight in preview when provided", async () => {
    const web = mockWebClient({
      getTeam: vi.fn().mockResolvedValue({ name: "Sales" }),
    });
    const res = await handleAddTeamMember(web, mockLogger(), { teamId: "t1", userId: "u1", weight: 5 });
    expect(res.content[0].text).toContain("5");
  });
});

// ---------------------------------------------------------------------------
// remove_team_member
// ---------------------------------------------------------------------------
describe("handleRemoveTeamMember", () => {
  it("returns preview", async () => {
    const web = mockWebClient({
      getTeam: vi.fn().mockResolvedValue({ name: "Sales" }),
    });
    const res = await handleRemoveTeamMember(web, mockLogger(), { teamId: "t1", userId: "u1" });
    expect(res.content[0].text).toContain("PREVIEW");
  });

  it("removes member when confirmed", async () => {
    const web = mockWebClient();
    const res = await handleRemoveTeamMember(web, mockLogger(), { teamId: "t1", userId: "u1", confirm: true });
    expect(res.content[0].text).toContain("removed");
    expect(web.removeTeamMember).toHaveBeenCalledWith("t1", "u1");
  });
});

// ---------------------------------------------------------------------------
// toggle_team_member
// ---------------------------------------------------------------------------
describe("handleToggleTeamMember", () => {
  it("returns preview with new status", async () => {
    const web = mockWebClient({
      getTeam: vi.fn().mockResolvedValue({ name: "Sales" }),
    });
    const res = await handleToggleTeamMember(web, mockLogger(), { teamId: "t1", userId: "u1", status: "PAUSED" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("PAUSED");
  });

  it("toggles when confirmed", async () => {
    const web = mockWebClient();
    const res = await handleToggleTeamMember(web, mockLogger(), { teamId: "t1", userId: "u1", status: "ACTIVE", confirm: true });
    expect(res.content[0].text).toContain("ACTIVE");
    expect(web.toggleTeamMember).toHaveBeenCalledWith("t1", "u1", { status: "ACTIVE" });
  });
});

// ---------------------------------------------------------------------------
// update_team_weights
// ---------------------------------------------------------------------------
describe("handleUpdateTeamWeights", () => {
  it("returns preview with weight details", async () => {
    const web = mockWebClient({
      getTeam: vi.fn().mockResolvedValue({ name: "Sales" }),
    });
    const weights = [{ userId: "u1", weight: 3 }, { userId: "u2", weight: 7 }];
    const res = await handleUpdateTeamWeights(web, mockLogger(), { teamId: "t1", weights });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("u1");
    expect(res.content[0].text).toContain("3");
  });

  it("updates weights when confirmed", async () => {
    const web = mockWebClient();
    const weights = [{ userId: "u1", weight: 5 }];
    const res = await handleUpdateTeamWeights(web, mockLogger(), { teamId: "t1", weights, confirm: true });
    expect(res.content[0].text).toContain("Weights updated");
    expect(web.updateTeamWeights).toHaveBeenCalledWith("t1", weights);
  });
});

// ---------------------------------------------------------------------------
// reset_team_pointer
// ---------------------------------------------------------------------------
describe("handleResetTeamPointer", () => {
  it("returns preview", async () => {
    const web = mockWebClient({
      getTeam: vi.fn().mockResolvedValue({ name: "Sales", distributionMethod: "ROUND_ROBIN" }),
    });
    const res = await handleResetTeamPointer(web, mockLogger(), { teamId: "t1" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Sales");
  });

  it("resets pointer when confirmed", async () => {
    const web = mockWebClient();
    const res = await handleResetTeamPointer(web, mockLogger(), { teamId: "t1", confirm: true });
    expect(res.content[0].text).toContain("reset");
    expect(web.resetTeamPointer).toHaveBeenCalledWith("t1");
  });
});
