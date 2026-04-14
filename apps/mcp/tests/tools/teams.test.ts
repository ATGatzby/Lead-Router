import { describe, it, expect, vi } from "vitest";
import { mockWebClient, mockLogger } from "../helpers";
import { handleListTeams } from "../../src/tools/list-teams.js";
import { handleCreateTeam } from "../../src/tools/create-team.js";
import { handleUpdateTeam } from "../../src/tools/update-team.js";
import { handleDeleteTeam } from "../../src/tools/delete-team.js";

// ---------------------------------------------------------------------------
// list_teams
// ---------------------------------------------------------------------------
describe("handleListTeams", () => {
  it("returns formatted teams summary", async () => {
    const web = mockWebClient({
      listTeams: vi.fn().mockResolvedValue({
        teams: [{ id: "t1", name: "Sales", distributionType: "ROUND_ROBIN", activeCount: 3, memberCount: 5, totalAssigned: 100 }],
      }),
    });
    const res = await handleListTeams(web, mockLogger());
    expect(res.content[0].text).toContain("Sales");
  });

  it("returns no teams message when empty", async () => {
    const web = mockWebClient({ listTeams: vi.fn().mockResolvedValue({ teams: [] }) });
    const res = await handleListTeams(web, mockLogger());
    expect(res.content[0].text).toContain("No teams");
  });
});

// ---------------------------------------------------------------------------
// create_team
// ---------------------------------------------------------------------------
describe("handleCreateTeam", () => {
  it("returns preview when confirm is false", async () => {
    const web = mockWebClient();
    const res = await handleCreateTeam(web, mockLogger(), { name: "New Team" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("New Team");
    expect(web.createTeam).not.toHaveBeenCalled();
  });

  it("creates team when confirmed", async () => {
    const web = mockWebClient({
      createTeam: vi.fn().mockResolvedValue({ id: "t1", name: "New Team" }),
    });
    const res = await handleCreateTeam(web, mockLogger(), { name: "New Team", confirm: true });
    expect(res.content[0].text).toContain("Team created");
    expect(web.createTeam).toHaveBeenCalled();
  });

  it("includes distribution type in preview", async () => {
    const web = mockWebClient();
    const res = await handleCreateTeam(web, mockLogger(), { name: "Weighted", distributionType: "WEIGHTED" });
    expect(res.content[0].text).toContain("WEIGHTED");
  });
});

// ---------------------------------------------------------------------------
// update_team
// ---------------------------------------------------------------------------
describe("handleUpdateTeam", () => {
  it("returns preview with diff", async () => {
    const web = mockWebClient({
      getTeam: vi.fn().mockResolvedValue({ id: "t1", name: "Old Name" }),
    });
    const res = await handleUpdateTeam(web, mockLogger(), { teamId: "t1", name: "New Name" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Old Name");
    expect(res.content[0].text).toContain("New Name");
  });

  it("updates when confirmed", async () => {
    const web = mockWebClient({
      updateTeam: vi.fn().mockResolvedValue({ id: "t1", name: "Updated" }),
    });
    const res = await handleUpdateTeam(web, mockLogger(), { teamId: "t1", name: "Updated", confirm: true });
    expect(res.content[0].text).toContain("Team updated");
  });
});

// ---------------------------------------------------------------------------
// delete_team
// ---------------------------------------------------------------------------
describe("handleDeleteTeam", () => {
  it("returns preview showing team details", async () => {
    const web = mockWebClient({
      getTeam: vi.fn().mockResolvedValue({ name: "Doomed", distributionType: "ROUND_ROBIN", members: [1, 2] }),
    });
    const res = await handleDeleteTeam(web, mockLogger(), { teamId: "t1" });
    expect(res.content[0].text).toContain("PREVIEW");
    expect(res.content[0].text).toContain("Doomed");
  });

  it("deletes when confirmed", async () => {
    const web = mockWebClient();
    const res = await handleDeleteTeam(web, mockLogger(), { teamId: "t1", confirm: true });
    expect(res.content[0].text).toContain("deleted");
    expect(web.deleteTeam).toHaveBeenCalledWith("t1");
  });
});
