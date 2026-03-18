import { describe, it, expect } from "vitest"
import {
  findPathById,
  updatePathById,
  removePathById,
  getPathDepth,
  flattenAllPaths,
  flattenAllSplits,
  updateSplitStep,
  migrateStateToV2,
  migratePathToSteps,
  MAX_SPLIT_DEPTH,
  type RoutePath,
  type PathStepSplit,
  type PathStep,
  type RouteBuilderState,
} from "./types"

// ── Test fixtures ─────────────────────────────────────────────────────────

function makePath(id: string, label: string, steps?: PathStep[]): RoutePath {
  return {
    id,
    label,
    conditions: [],
    action: { assignmentType: null, assigneeId: null, assigneeName: null },
    ...(steps ? { steps } : {}),
  }
}

function makeFilter(): PathStep {
  return {
    type: "filter",
    conditions: [
      {
        id: "g1",
        conjunction: "AND" as const,
        conditions: [
          {
            id: "c1",
            groupId: "g1",
            fieldApiName: "Industry",
            fieldType: "TEXT" as const,
            operator: "equals",
            value: "Tech",
          },
        ],
      },
    ],
  }
}

function makeAssign(name: string): PathStep {
  return {
    type: "assign",
    assignmentType: "USER",
    assigneeId: `user-${name}`,
    assigneeName: name,
  }
}

function makeSplit(subPaths: RoutePath[]): PathStepSplit {
  return {
    type: "split",
    paths: subPaths,
    defaultOwner: null,
  }
}

/**
 * Build a tree with known structure:
 * - root-a (depth 0)
 *   - split step containing:
 *     - child-a1 (depth 1)
 *       - split step containing:
 *         - grandchild-a1a (depth 2)
 *         - grandchild-a1b (depth 2)
 *     - child-a2 (depth 1)
 * - root-b (depth 0)
 */
function makeDeepTree(): RoutePath[] {
  const grandchildA1a = makePath("grandchild-a1a", "GC A1a", [makeFilter(), makeAssign("Alice")])
  const grandchildA1b = makePath("grandchild-a1b", "GC A1b", [makeFilter(), makeAssign("Bob")])

  const childA1 = makePath("child-a1", "Child A1", [
    makeFilter(),
    makeSplit([grandchildA1a, grandchildA1b]),
  ])
  const childA2 = makePath("child-a2", "Child A2", [makeFilter(), makeAssign("Carol")])

  const rootA = makePath("root-a", "Root A", [
    makeFilter(),
    makeSplit([childA1, childA2]),
  ])
  const rootB = makePath("root-b", "Root B", [makeFilter(), makeAssign("Dave")])

  return [rootA, rootB]
}

/** Build a 4-level deep tree for depth stress testing */
function makeVeryDeepTree(): RoutePath[] {
  const level3 = makePath("level-3", "Level 3", [makeFilter(), makeAssign("Deep")])
  const level2 = makePath("level-2", "Level 2", [makeFilter(), makeSplit([level3])])
  const level1 = makePath("level-1", "Level 1", [makeFilter(), makeSplit([level2])])
  const level0 = makePath("level-0", "Level 0", [makeFilter(), makeSplit([level1])])
  return [level0]
}

// ── findPathById ──────────────────────────────────────────────────────────

describe("findPathById", () => {
  it("finds a top-level path (depth 0)", () => {
    const tree = makeDeepTree()
    const found = findPathById(tree, "root-a")
    expect(found).not.toBeNull()
    expect(found!.label).toBe("Root A")
  })

  it("finds a path at depth 1", () => {
    const tree = makeDeepTree()
    const found = findPathById(tree, "child-a1")
    expect(found).not.toBeNull()
    expect(found!.label).toBe("Child A1")
  })

  it("finds a path at depth 2", () => {
    const tree = makeDeepTree()
    const found = findPathById(tree, "grandchild-a1b")
    expect(found).not.toBeNull()
    expect(found!.label).toBe("GC A1b")
  })

  it("finds a path at depth 3", () => {
    const tree = makeVeryDeepTree()
    const found = findPathById(tree, "level-3")
    expect(found).not.toBeNull()
    expect(found!.label).toBe("Level 3")
  })

  it("returns null for a non-existent ID", () => {
    const tree = makeDeepTree()
    expect(findPathById(tree, "does-not-exist")).toBeNull()
  })

  it("returns null for empty array", () => {
    expect(findPathById([], "any-id")).toBeNull()
  })

  it("finds second top-level path", () => {
    const tree = makeDeepTree()
    const found = findPathById(tree, "root-b")
    expect(found).not.toBeNull()
    expect(found!.label).toBe("Root B")
  })
})

// ── updatePathById ────────────────────────────────────────────────────────

describe("updatePathById", () => {
  it("updates a top-level path", () => {
    const tree = makeDeepTree()
    const updated = updatePathById(tree, "root-b", (p) => ({ ...p, label: "Updated Root B" }))
    expect(findPathById(updated, "root-b")!.label).toBe("Updated Root B")
  })

  it("updates a path at depth 1", () => {
    const tree = makeDeepTree()
    const updated = updatePathById(tree, "child-a2", (p) => ({ ...p, label: "Updated Child A2" }))
    expect(findPathById(updated, "child-a2")!.label).toBe("Updated Child A2")
  })

  it("updates a path at depth 2", () => {
    const tree = makeDeepTree()
    const updated = updatePathById(tree, "grandchild-a1a", (p) => ({ ...p, label: "Updated GC" }))
    expect(findPathById(updated, "grandchild-a1a")!.label).toBe("Updated GC")
  })

  it("returns a new array (immutability)", () => {
    const tree = makeDeepTree()
    const updated = updatePathById(tree, "root-a", (p) => ({ ...p, label: "Changed" }))
    expect(updated).not.toBe(tree)
    // Original unchanged
    expect(tree[0].label).toBe("Root A")
    expect(updated[0].label).toBe("Changed")
  })

  it("does not mutate unrelated branches", () => {
    const tree = makeDeepTree()
    const updated = updatePathById(tree, "grandchild-a1a", (p) => ({ ...p, label: "X" }))
    // root-b should be the same object reference (no unnecessary cloning)
    expect(updated[1]).toBe(tree[1])
  })

  it("no-ops for non-existent ID", () => {
    const tree = makeDeepTree()
    const updated = updatePathById(tree, "nonexistent", (p) => ({ ...p, label: "X" }))
    // All paths unchanged
    expect(findPathById(updated, "root-a")!.label).toBe("Root A")
    expect(findPathById(updated, "root-b")!.label).toBe("Root B")
  })
})

// ── removePathById ────────────────────────────────────────────────────────

describe("removePathById", () => {
  it("removes a top-level path", () => {
    const tree = makeDeepTree()
    const updated = removePathById(tree, "root-b")
    expect(updated).toHaveLength(1)
    expect(findPathById(updated, "root-b")).toBeNull()
  })

  it("removes a path at depth 1", () => {
    const tree = makeDeepTree()
    const updated = removePathById(tree, "child-a2")
    expect(findPathById(updated, "child-a2")).toBeNull()
    // Sibling still exists
    expect(findPathById(updated, "child-a1")).not.toBeNull()
  })

  it("removes a path at depth 2", () => {
    const tree = makeDeepTree()
    const updated = removePathById(tree, "grandchild-a1b")
    expect(findPathById(updated, "grandchild-a1b")).toBeNull()
    // Sibling still exists
    expect(findPathById(updated, "grandchild-a1a")).not.toBeNull()
  })

  it("preserves parent structure after removal", () => {
    const tree = makeDeepTree()
    const updated = removePathById(tree, "grandchild-a1a")
    // Parent still exists
    const parent = findPathById(updated, "child-a1")
    expect(parent).not.toBeNull()
    // Parent's split step should still exist with one sub-path
    const splitStep = parent!.steps!.find((s) => s.type === "split") as PathStepSplit
    expect(splitStep.paths).toHaveLength(1)
    expect(splitStep.paths[0].id).toBe("grandchild-a1b")
  })

  it("no-ops for non-existent ID", () => {
    const tree = makeDeepTree()
    const updated = removePathById(tree, "nonexistent")
    expect(updated).toHaveLength(2)
    expect(flattenAllPaths(updated).length).toBe(flattenAllPaths(tree).length)
  })
})

// ── getPathDepth ──────────────────────────────────────────────────────────

describe("getPathDepth", () => {
  it("returns 0 for top-level paths", () => {
    const tree = makeDeepTree()
    expect(getPathDepth(tree, "root-a")).toBe(0)
    expect(getPathDepth(tree, "root-b")).toBe(0)
  })

  it("returns 1 for depth-1 paths", () => {
    const tree = makeDeepTree()
    expect(getPathDepth(tree, "child-a1")).toBe(1)
    expect(getPathDepth(tree, "child-a2")).toBe(1)
  })

  it("returns 2 for depth-2 paths", () => {
    const tree = makeDeepTree()
    expect(getPathDepth(tree, "grandchild-a1a")).toBe(2)
    expect(getPathDepth(tree, "grandchild-a1b")).toBe(2)
  })

  it("returns correct depth for 4-level deep tree", () => {
    const tree = makeVeryDeepTree()
    expect(getPathDepth(tree, "level-0")).toBe(0)
    expect(getPathDepth(tree, "level-1")).toBe(1)
    expect(getPathDepth(tree, "level-2")).toBe(2)
    expect(getPathDepth(tree, "level-3")).toBe(3)
  })

  it("returns -1 for non-existent ID", () => {
    const tree = makeDeepTree()
    expect(getPathDepth(tree, "nonexistent")).toBe(-1)
  })

  it("returns -1 for empty tree", () => {
    expect(getPathDepth([], "any")).toBe(-1)
  })
})

// ── flattenAllPaths ───────────────────────────────────────────────────────

describe("flattenAllPaths", () => {
  it("returns correct count for deep tree", () => {
    const tree = makeDeepTree()
    const flat = flattenAllPaths(tree)
    // root-a, root-b, child-a1, child-a2, grandchild-a1a, grandchild-a1b = 6
    expect(flat).toHaveLength(6)
  })

  it("assigns correct depth metadata", () => {
    const tree = makeDeepTree()
    const flat = flattenAllPaths(tree)
    const byId = new Map(flat.map((f) => [f.path.id, f]))

    expect(byId.get("root-a")!.depth).toBe(0)
    expect(byId.get("root-b")!.depth).toBe(0)
    expect(byId.get("child-a1")!.depth).toBe(1)
    expect(byId.get("child-a2")!.depth).toBe(1)
    expect(byId.get("grandchild-a1a")!.depth).toBe(2)
    expect(byId.get("grandchild-a1b")!.depth).toBe(2)
  })

  it("assigns correct parentPathId metadata", () => {
    const tree = makeDeepTree()
    const flat = flattenAllPaths(tree)
    const byId = new Map(flat.map((f) => [f.path.id, f]))

    expect(byId.get("root-a")!.parentPathId).toBeUndefined()
    expect(byId.get("child-a1")!.parentPathId).toBe("root-a")
    expect(byId.get("grandchild-a1a")!.parentPathId).toBe("child-a1")
  })

  it("returns empty array for empty tree", () => {
    expect(flattenAllPaths([])).toEqual([])
  })

  it("handles paths without steps", () => {
    const paths: RoutePath[] = [makePath("simple", "Simple")]
    const flat = flattenAllPaths(paths)
    expect(flat).toHaveLength(1)
    expect(flat[0].depth).toBe(0)
  })

  it("returns correct count for 4-level deep tree", () => {
    const tree = makeVeryDeepTree()
    const flat = flattenAllPaths(tree)
    // level-0, level-1, level-2, level-3 = 4
    expect(flat).toHaveLength(4)
  })
})

// ── flattenAllSplits ──────────────────────────────────────────────────────

describe("flattenAllSplits", () => {
  it("finds all split steps in the tree", () => {
    const tree = makeDeepTree()
    const splits = flattenAllSplits(tree)
    // root-a has a split (containing child-a1, child-a2)
    // child-a1 has a split (containing grandchild-a1a, grandchild-a1b)
    expect(splits).toHaveLength(2)
  })

  it("assigns correct parentPathId", () => {
    const tree = makeDeepTree()
    const splits = flattenAllSplits(tree)
    const parentIds = splits.map((s) => s.parentPathId)
    expect(parentIds).toContain("root-a")
    expect(parentIds).toContain("child-a1")
  })

  it("assigns correct depth", () => {
    const tree = makeDeepTree()
    const splits = flattenAllSplits(tree)
    const rootASplit = splits.find((s) => s.parentPathId === "root-a")!
    const childA1Split = splits.find((s) => s.parentPathId === "child-a1")!
    expect(rootASplit.depth).toBe(1)
    expect(childA1Split.depth).toBe(2)
  })

  it("returns empty array for tree without splits", () => {
    const tree: RoutePath[] = [makePath("simple", "Simple", [makeFilter(), makeAssign("Alice")])]
    expect(flattenAllSplits(tree)).toEqual([])
  })

  it("returns empty array for empty tree", () => {
    expect(flattenAllSplits([])).toEqual([])
  })

  it("finds 3 splits in 4-level deep tree", () => {
    const tree = makeVeryDeepTree()
    const splits = flattenAllSplits(tree)
    // level-0 has a split, level-1 has a split, level-2 has a split
    expect(splits).toHaveLength(3)
  })
})

// ── updateSplitStep ───────────────────────────────────────────────────────

describe("updateSplitStep", () => {
  it("updates a split step at depth 0", () => {
    const tree = makeDeepTree()
    // root-a has a split at step index 1
    const updated = updateSplitStep(tree, "root-a", 1, (split) => ({
      ...split,
      defaultOwner: { assignmentType: "USER", assigneeId: "user-fallback", assigneeName: "Fallback" },
    }))
    const rootA = findPathById(updated, "root-a")!
    const splitStep = rootA.steps![1] as PathStepSplit
    expect(splitStep.defaultOwner).not.toBeNull()
    expect(splitStep.defaultOwner!.assigneeName).toBe("Fallback")
  })

  it("updates a split step at depth 1", () => {
    const tree = makeDeepTree()
    // child-a1 has a split at step index 1
    const updated = updateSplitStep(tree, "child-a1", 1, (split) => ({
      ...split,
      defaultOwner: { assignmentType: "QUEUE", assigneeId: "q1", assigneeName: "Queue 1" },
    }))
    const childA1 = findPathById(updated, "child-a1")!
    const splitStep = childA1.steps![1] as PathStepSplit
    expect(splitStep.defaultOwner!.assignmentType).toBe("QUEUE")
  })

  it("does not update non-split steps", () => {
    const tree = makeDeepTree()
    // root-a step 0 is a filter, not a split — this should be a no-op
    const updated = updateSplitStep(tree, "root-a", 0, (split) => ({
      ...split,
      defaultOwner: { assignmentType: "USER", assigneeId: "x", assigneeName: "X" },
    }))
    const rootA = findPathById(updated, "root-a")!
    expect(rootA.steps![0].type).toBe("filter")
  })
})

// ── migrateStateToV2 / migratePathToSteps ─────────────────────────────────

describe("migrateStateToV2", () => {
  it("adds steps to a legacy path without steps", () => {
    const state: RouteBuilderState = {
      name: "Test",
      routeType: "REALTIME",
      trigger: null,
      searchTrigger: null,
      matchConfig: null,
      paths: [
        {
          id: "p1",
          label: "Legacy",
          conditions: [
            {
              id: "g1",
              conjunction: "AND",
              conditions: [
                { id: "c1", groupId: "g1", fieldApiName: "Industry", fieldType: "TEXT", operator: "equals", value: "Tech" },
              ],
            },
          ],
          action: { assignmentType: "USER", assigneeId: "u1", assigneeName: "Alice" },
        },
      ],
      defaultOwner: null,
    }
    const migrated = migrateStateToV2(state)
    expect(migrated.paths[0].steps).toBeDefined()
    expect(migrated.paths[0].steps).toHaveLength(2)
    expect(migrated.paths[0].steps![0].type).toBe("filter")
    expect(migrated.paths[0].steps![1].type).toBe("assign")
  })

  it("preserves existing steps on V2 paths", () => {
    const state: RouteBuilderState = {
      name: "Test",
      routeType: "REALTIME",
      trigger: null,
      searchTrigger: null,
      matchConfig: null,
      paths: [
        makePath("p1", "V2 Path", [
          makeFilter(),
          { type: "updateField", fieldApiName: "Status", fieldValue: "Routed" },
          makeAssign("Alice"),
        ]),
      ],
      defaultOwner: null,
    }
    const migrated = migrateStateToV2(state)
    expect(migrated.paths[0].steps).toHaveLength(3)
    expect(migrated.paths[0].steps![1].type).toBe("updateField")
  })

  it("recursively migrates paths inside splits", () => {
    const legacySubPath: RoutePath = {
      id: "sub1",
      label: "Sub Legacy",
      conditions: [
        {
          id: "g1",
          conjunction: "AND",
          conditions: [
            { id: "c1", groupId: "g1", fieldApiName: "State", fieldType: "TEXT", operator: "equals", value: "CA" },
          ],
        },
      ],
      action: { assignmentType: "ROUND_ROBIN", assigneeId: "team1", assigneeName: "Team 1" },
      // NO steps — legacy
    }

    const state: RouteBuilderState = {
      name: "Test",
      routeType: "REALTIME",
      trigger: null,
      searchTrigger: null,
      matchConfig: null,
      paths: [
        makePath("root", "Root", [
          makeFilter(),
          makeSplit([legacySubPath]),
        ]),
      ],
      defaultOwner: null,
    }

    const migrated = migrateStateToV2(state)
    const splitStep = migrated.paths[0].steps![1] as PathStepSplit
    const subPath = splitStep.paths[0]
    expect(subPath.steps).toBeDefined()
    expect(subPath.steps).toHaveLength(2)
    expect(subPath.steps![0].type).toBe("filter")
    expect(subPath.steps![1].type).toBe("assign")
  })
})

describe("migratePathToSteps", () => {
  it("creates filter + assign from conditions and action", () => {
    const path: RoutePath = {
      id: "p1",
      label: "Test",
      conditions: [
        {
          id: "g1",
          conjunction: "AND",
          conditions: [
            { id: "c1", groupId: "g1", fieldApiName: "Revenue", fieldType: "NUMBER", operator: "gt", value: "100" },
          ],
        },
      ],
      action: { assignmentType: "QUEUE", assigneeId: "q1", assigneeName: "Q1" },
    }
    const steps = migratePathToSteps(path)
    expect(steps).toHaveLength(2)
    expect(steps[0].type).toBe("filter")
    expect(steps[1].type).toBe("assign")
    if (steps[1].type === "assign") {
      expect(steps[1].assignmentType).toBe("QUEUE")
      expect(steps[1].assigneeId).toBe("q1")
    }
  })
})

// ── MAX_SPLIT_DEPTH constant ──────────────────────────────────────────────

describe("MAX_SPLIT_DEPTH", () => {
  it("is 5", () => {
    expect(MAX_SPLIT_DEPTH).toBe(5)
  })
})
