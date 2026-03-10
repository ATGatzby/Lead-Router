import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockEval, mockSet } = vi.hoisted(() => ({
  mockEval: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock("./redis.js", () => ({
  redis: {
    eval: mockEval,
    set: mockSet,
  },
}));

import { getNextMember, resetPointer, type TeamMember } from "./round-robin.js";

function member(id: string, name: string): TeamMember {
  return {
    id,
    userId: `user-${id}`,
    name,
    email: `${name.toLowerCase()}@example.com`,
    assignmentCount: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── getNextMember ───────────────────────────────────────────────────────────

describe("getNextMember", () => {
  const orgId = "org-1";
  const teamId = "team-1";
  const members: TeamMember[] = [
    member("m1", "Alice"),
    member("m2", "Bob"),
    member("m3", "Carol"),
  ];

  it("returns the member at the index returned by the Lua script", async () => {
    mockEval.mockResolvedValue(0);
    const result = await getNextMember(orgId, teamId, members);
    expect(result).toEqual(members[0]);
  });

  it("cycles through members: 0 → 1 → 2 → 0", async () => {
    mockEval.mockResolvedValueOnce(0);
    expect(await getNextMember(orgId, teamId, members)).toEqual(members[0]);

    mockEval.mockResolvedValueOnce(1);
    expect(await getNextMember(orgId, teamId, members)).toEqual(members[1]);

    mockEval.mockResolvedValueOnce(2);
    expect(await getNextMember(orgId, teamId, members)).toEqual(members[2]);

    mockEval.mockResolvedValueOnce(0);
    expect(await getNextMember(orgId, teamId, members)).toEqual(members[0]);
  });

  it("returns null for an empty member list", async () => {
    const result = await getNextMember(orgId, teamId, []);
    expect(result).toBeNull();
    // Lua script should not be called when there are no members
    expect(mockEval).not.toHaveBeenCalled();
  });

  it("always returns the single member when list has one entry", async () => {
    const single = [member("m1", "Alice")];
    mockEval.mockResolvedValue(0);
    expect(await getNextMember(orgId, teamId, single)).toEqual(single[0]);
  });

  it("returns null when the Lua script returns -1", async () => {
    mockEval.mockResolvedValue(-1);
    const result = await getNextMember(orgId, teamId, members);
    expect(result).toBeNull();
  });

  it("uses the correct Redis key format: rr:{orgId}:{teamId}:pointer", async () => {
    mockEval.mockResolvedValue(0);
    await getNextMember("org-abc", "team-xyz", members);
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String), // Lua script
      1,
      "rr:org-abc:team-xyz:pointer",
      String(members.length)
    );
  });

  it("passes member count as a string argument to Redis eval", async () => {
    mockEval.mockResolvedValue(0);
    await getNextMember(orgId, teamId, members);
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.any(String),
      "3"
    );
  });
});

// ─── resetPointer ────────────────────────────────────────────────────────────

describe("resetPointer", () => {
  it("sets the Redis key to 0", async () => {
    mockSet.mockResolvedValue("OK");
    await resetPointer("org-1", "team-1");
    expect(mockSet).toHaveBeenCalledWith("rr:org-1:team-1:pointer", 0);
  });

  it("uses the correct Redis key format", async () => {
    mockSet.mockResolvedValue("OK");
    await resetPointer("org-abc", "team-xyz");
    expect(mockSet).toHaveBeenCalledWith("rr:org-abc:team-xyz:pointer", 0);
  });
});
