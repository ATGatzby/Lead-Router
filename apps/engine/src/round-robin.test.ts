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

import {
  getNextMember,
  resetPointer,
  getNextWeightedMember,
  resetWeightedPointer,
  type TeamMember,
  type WeightedTeamMember,
} from "./round-robin.js";

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

// ─── Weighted Round Robin ─────────────────────────────────────────────────────

function weightedMember(id: string, name: string, weight: number): WeightedTeamMember {
  return {
    id,
    userId: `user-${id}`,
    name,
    email: `${name.toLowerCase()}@example.com`,
    assignmentCount: 0,
    weight,
  };
}

describe("getNextWeightedMember", () => {
  const orgId = "org-1";
  const teamId = "team-1";

  it("returns null for empty member list", async () => {
    const result = await getNextWeightedMember(orgId, teamId, []);
    expect(result).toBeNull();
    expect(mockEval).not.toHaveBeenCalled();
  });

  it("uses wrr: Redis key prefix (separate from equal RR)", async () => {
    const members = [weightedMember("m1", "Alice", 1)];
    mockEval.mockResolvedValue(0);
    await getNextWeightedMember("org-abc", "team-xyz", members);
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "wrr:org-abc:team-xyz:pointer",
      "1"
    );
  });

  it("returns the only member when there is just one", async () => {
    const members = [weightedMember("m1", "Alice", 5)];
    mockEval.mockResolvedValue(0);
    const result = await getNextWeightedMember(orgId, teamId, members);
    expect(result).toEqual(members[0]);
  });

  it("normalizes weights by GCD — [40,40,20] becomes 5 slots", async () => {
    const members = [
      weightedMember("m1", "Alice", 40),
      weightedMember("m2", "Bob", 40),
      weightedMember("m3", "Carol", 20),
    ];
    mockEval.mockResolvedValue(0);
    await getNextWeightedMember(orgId, teamId, members);
    // GCD(40,40,20) = 20 → slots: [2,2,1] = 5 total
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.any(String),
      "5"
    );
  });

  it("distributes according to weights over a full cycle", async () => {
    const members = [
      weightedMember("m1", "Alice", 40),
      weightedMember("m2", "Bob", 40),
      weightedMember("m3", "Carol", 20),
    ];
    // GCD=20 → 5 slots. Simulate a full cycle.
    const assignments: string[] = [];
    for (let i = 0; i < 5; i++) {
      mockEval.mockResolvedValueOnce(i);
      const result = await getNextWeightedMember(orgId, teamId, members);
      assignments.push(result!.name);
    }

    // Alice and Bob should each appear 2 times, Carol 1 time
    const counts = { Alice: 0, Bob: 0, Carol: 0 };
    assignments.forEach((n) => counts[n as keyof typeof counts]++);
    expect(counts.Alice).toBe(2);
    expect(counts.Bob).toBe(2);
    expect(counts.Carol).toBe(1);
  });

  it("interleaves members rather than clustering them", async () => {
    const members = [
      weightedMember("m1", "Alice", 2),
      weightedMember("m2", "Bob", 1),
    ];
    // 3 slots total. Should be [Alice, Bob, Alice] not [Alice, Alice, Bob]
    const assignments: string[] = [];
    for (let i = 0; i < 3; i++) {
      mockEval.mockResolvedValueOnce(i);
      const result = await getNextWeightedMember(orgId, teamId, members);
      assignments.push(result!.name);
    }
    // Alice should NOT appear consecutively at positions 0 and 1
    expect(assignments[0]).toBe("Alice");
    expect(assignments[1]).toBe("Bob");
    expect(assignments[2]).toBe("Alice");
  });

  it("handles equal weights — behaves like simple RR", async () => {
    const members = [
      weightedMember("m1", "Alice", 1),
      weightedMember("m2", "Bob", 1),
      weightedMember("m3", "Carol", 1),
    ];
    // GCD=1 → 3 slots
    mockEval.mockResolvedValue(0);
    await getNextWeightedMember(orgId, teamId, members);
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.any(String),
      "3"
    );
  });

  it("returns null when Lua script returns -1", async () => {
    const members = [weightedMember("m1", "Alice", 5)];
    mockEval.mockResolvedValue(-1);
    const result = await getNextWeightedMember(orgId, teamId, members);
    expect(result).toBeNull();
  });

  it("handles highly skewed weights — [9,1] gives 10 slots total", async () => {
    const members = [
      weightedMember("m1", "Alice", 9),
      weightedMember("m2", "Bob", 1),
    ];
    mockEval.mockResolvedValue(0);
    await getNextWeightedMember(orgId, teamId, members);
    // GCD(9,1) = 1 → 10 slots
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.any(String),
      "10"
    );
  });

  it("distributes [9,1] giving Alice 9 slots and Bob 1 over a full cycle", async () => {
    const members = [
      weightedMember("m1", "Alice", 9),
      weightedMember("m2", "Bob", 1),
    ];
    const assignments: string[] = [];
    for (let i = 0; i < 10; i++) {
      mockEval.mockResolvedValueOnce(i);
      const result = await getNextWeightedMember(orgId, teamId, members);
      assignments.push(result!.name);
    }
    const counts = { Alice: 0, Bob: 0 };
    assignments.forEach((n) => counts[n as keyof typeof counts]++);
    expect(counts.Alice).toBe(9);
    expect(counts.Bob).toBe(1);
  });

  it("handles large equal weights — [50,50] normalizes to 2 slots", async () => {
    const members = [
      weightedMember("m1", "Alice", 50),
      weightedMember("m2", "Bob", 50),
    ];
    mockEval.mockResolvedValue(0);
    await getNextWeightedMember(orgId, teamId, members);
    // GCD(50,50) = 50 → 2 slots
    expect(mockEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.any(String),
      "2"
    );
  });
});

// ─── resetWeightedPointer ─────────────────────────────────────────────────────

describe("resetWeightedPointer", () => {
  it("sets the wrr: Redis key to 0", async () => {
    mockSet.mockResolvedValue("OK");
    await resetWeightedPointer("org-1", "team-1");
    expect(mockSet).toHaveBeenCalledWith("wrr:org-1:team-1:pointer", 0);
  });

  it("uses the correct Redis key format", async () => {
    mockSet.mockResolvedValue("OK");
    await resetWeightedPointer("org-abc", "team-xyz");
    expect(mockSet).toHaveBeenCalledWith("wrr:org-abc:team-xyz:pointer", 0);
  });
});
