import { describe, it, expect } from "vitest"
import { routeToEnglish, conditionToText, type EnglishLine } from "./route-to-english"
import type { RouteBuilderState, SearchTriggerConfig } from "@/components/route-builder/types"
import { defaultBuilderState, defaultTriggerConfig } from "@/components/route-builder/types"
import type { Condition, ConditionGroup } from "@/components/condition-builder/types"

/** Extract text from a line (handles both string and EnglishLine) */
const lt = (line: string | EnglishLine): string => typeof line === "string" ? line : line.text

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCond(overrides: Partial<Condition> = {}): Condition {
  return {
    id: "c1",
    groupId: "g1",
    fieldApiName: "AnnualRevenue",
    fieldType: "NUMBER",
    operator: "gte",
    value: "1000000",
    ...overrides,
  }
}

function makeGroup(
  conditions: Condition[],
  conjunction: "AND" | "OR" = "AND"
): ConditionGroup {
  return { id: "g1", conjunction, conditions }
}

function makeState(overrides: Partial<RouteBuilderState> = {}): RouteBuilderState {
  return { ...defaultBuilderState(), ...overrides }
}

// ── conditionToText ──────────────────────────────────────────────────────────

describe("conditionToText", () => {
  it("renders field + operator + value", () => {
    expect(conditionToText(makeCond())).toBe('AnnualRevenue is at least "1000000"')
  })

  it("renders no-value operators without value", () => {
    expect(
      conditionToText(makeCond({ operator: "is_blank", value: "" }))
    ).toBe("AnnualRevenue is blank")
  })

  it("falls back to raw operator if unknown", () => {
    expect(
      conditionToText(makeCond({ operator: "custom_op" }))
    ).toBe('AnnualRevenue custom_op "1000000"')
  })
})

// ── Trigger section ──────────────────────────────────────────────────────────

describe("trigger section", () => {
  it("renders INSERT event", () => {
    const review = routeToEnglish(makeState({ trigger: defaultTriggerConfig() }))
    const trigger = review.sections.find((s) => s.type === "trigger")!
    expect(trigger.lines[0]).toContain("When a Lead is created")
    expect(trigger.lines[0]).toContain("all Leads will be processed")
  })

  it("renders UPDATE event", () => {
    const review = routeToEnglish(
      makeState({
        trigger: {
          ...defaultTriggerConfig(),
          triggerEvent: "UPDATE",
        },
      })
    )
    const trigger = review.sections.find((s) => s.type === "trigger")!
    expect(trigger.lines[0]).toContain("updated")
  })

  it("renders BOTH event", () => {
    const review = routeToEnglish(
      makeState({
        trigger: {
          ...defaultTriggerConfig(),
          triggerEvent: "BOTH",
        },
      })
    )
    const trigger = review.sections.find((s) => s.type === "trigger")!
    expect(trigger.lines[0]).toContain("created or updated")
  })

  it("renders Contact object type", () => {
    const review = routeToEnglish(
      makeState({
        trigger: {
          ...defaultTriggerConfig(),
          objectType: "CONTACT",
        },
      })
    )
    const trigger = review.sections.find((s) => s.type === "trigger")!
    expect(trigger.lines[0]).toContain("Contact")
  })

  it("includes trigger conditions", () => {
    const review = routeToEnglish(
      makeState({
        trigger: {
          ...defaultTriggerConfig(),
          triggerConditions: [makeGroup([makeCond({ fieldApiName: "LeadSource", operator: "equals", value: "Web" })])],
        },
      })
    )
    const trigger = review.sections.find((s) => s.type === "trigger")!
    expect(trigger.lines[0]).toContain("where")
    expect(trigger.lines[0]).toContain("LeadSource")
  })

  it("includes dry run line", () => {
    const review = routeToEnglish(
      makeState({
        trigger: { ...defaultTriggerConfig(), isDryRun: true },
      })
    )
    const trigger = review.sections.find((s) => s.type === "trigger")!
    expect(trigger.lines).toHaveLength(2)
    expect(trigger.lines[1]).toContain("Dry run")
  })
})

// ── Match section ────────────────────────────────────────────────────────────

describe("match section", () => {
  it("is not present when matchConfig is null", () => {
    const review = routeToEnglish(makeState())
    expect(review.sections.find((s) => s.type === "match")).toBeUndefined()
  })

  it("renders checked objects and fields", () => {
    const review = routeToEnglish(
      makeState({
        matchConfig: {
          checkLeads: true,
          checkContacts: true,
          checkAccounts: false,
          matchEmail: true,
          matchPhone: false,
          matchDomain: true,
          matchCompanyName: false,
          fuzzyMatchMode: "STRICT",
          onLeadMatch: "SFDC_MERGE",
          leadCustomAssignment: null,
          onContactMatch: "ASSIGN_TO_OWNER",
          contactCustomAssignment: null,
          onAccountMatch: "SKIP",
          accountCustomAssignment: null,
        },
      })
    )
    const match = review.sections.find((s) => s.type === "match")!
    expect(match.lines[0]).toContain("Leads/Contacts")
    expect(match.lines[0]).toContain("email")
    expect(match.lines[0]).toContain("domain")
  })

  it("renders fuzzy mode when not STRICT", () => {
    const review = routeToEnglish(
      makeState({
        matchConfig: {
          checkLeads: true,
          checkContacts: false,
          checkAccounts: false,
          matchEmail: true,
          matchPhone: false,
          matchDomain: false,
          matchCompanyName: false,
          fuzzyMatchMode: "FUZZY",
          onLeadMatch: "ASSIGN_TO_OWNER",
          leadCustomAssignment: null,
          onContactMatch: "SKIP",
          contactCustomAssignment: null,
          onAccountMatch: "SKIP",
          accountCustomAssignment: null,
        },
      })
    )
    const match = review.sections.find((s) => s.type === "match")!
    expect(match.lines.some((l) => lt(l).includes("fuzzy"))).toBe(true)
  })

  it("renders per-object actions", () => {
    const review = routeToEnglish(
      makeState({
        matchConfig: {
          checkLeads: true,
          checkContacts: false,
          checkAccounts: false,
          matchEmail: true,
          matchPhone: false,
          matchDomain: false,
          matchCompanyName: false,
          fuzzyMatchMode: "STRICT",
          onLeadMatch: "SFDC_MERGE",
          leadCustomAssignment: null,
          onContactMatch: "SKIP",
          contactCustomAssignment: null,
          onAccountMatch: "SKIP",
          accountCustomAssignment: null,
        },
      })
    )
    const match = review.sections.find((s) => s.type === "match")!
    expect(match.lines.some((l) => lt(l).includes("merge records"))).toBe(true)
  })
})

// ── Path sections ────────────────────────────────────────────────────────────

describe("path sections", () => {
  it("renders path with conditions", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "Enterprise",
            conditions: [makeGroup([makeCond()])],
            action: { assignmentType: "ROUND_ROBIN", assigneeId: "t1", assigneeName: "Enterprise Team" },
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    expect(path.title).toContain("Enterprise")
    expect(path.lines[0]).toContain("AnnualRevenue")
    expect(path.lines[0]).toContain("round robin")
    expect(path.lines[0]).toContain("Enterprise Team")
    expect(path.status).toBe("ok")
    expect(path.pathIndex).toBe(0)
  })

  it("renders catch-all path", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "Catch All",
            conditions: [],
            action: { assignmentType: "USER", assigneeId: "u1", assigneeName: "John" },
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    expect(path.lines[0]).toContain("All remaining records")
  })

  it("renders unconfigured path as error", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "Broken",
            conditions: [],
            action: { assignmentType: null, assigneeId: null, assigneeName: null },
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    expect(path.status).toBe("error")
    expect(path.lines[0]).toContain("not configured")
  })

  it("renders OR groups", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "Multi",
            conditions: [
              makeGroup([makeCond({ id: "c1", fieldApiName: "Industry", operator: "equals", value: "Tech" })]),
              { id: "g2", conjunction: "AND", conditions: [makeCond({ id: "c2", fieldApiName: "State", operator: "equals", value: "CA" })] },
            ],
            action: { assignmentType: "QUEUE", assigneeId: "q1", assigneeName: "West Coast" },
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    expect(path.lines[0]).toContain("or")
  })
})

// ── Default owner section ────────────────────────────────────────────────────

describe("default owner section", () => {
  it("is not present when null", () => {
    const review = routeToEnglish(makeState())
    expect(review.sections.find((s) => s.type === "default")).toBeUndefined()
  })

  it("renders default owner", () => {
    const review = routeToEnglish(
      makeState({
        defaultOwner: { assignmentType: "USER", assigneeId: "u1", assigneeName: "Jane Doe" },
      })
    )
    const def = review.sections.find((s) => s.type === "default")!
    expect(def.lines[0]).toContain("Jane Doe")
    expect(def.lines[0]).toContain("user")
  })
})

// ── Warnings ─────────────────────────────────────────────────────────────────

describe("warnings", () => {
  it("detects unconfigured assignment", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          { id: "p1", label: "Broken", conditions: [], action: { assignmentType: null, assigneeId: null, assigneeName: null } },
        ],
      })
    )
    const w = review.warnings.find((w) => w.severity === "error" && w.message.includes("no assignment"))
    expect(w).toBeDefined()
  })

  it("detects unreachable paths (catch-all before conditional)", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          { id: "p1", label: "Catch All", conditions: [], action: { assignmentType: "USER", assigneeId: "u1", assigneeName: "A" } },
          { id: "p2", label: "Enterprise", conditions: [makeGroup([makeCond()])], action: { assignmentType: "USER", assigneeId: "u2", assigneeName: "B" } },
        ],
      })
    )
    const w = review.warnings.find((w) => w.severity === "error" && w.message.includes("unreachable"))
    expect(w).toBeDefined()
  })

  it("detects multiple catch-alls", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          { id: "p1", label: "A", conditions: [], action: { assignmentType: "USER", assigneeId: "u1", assigneeName: "A" } },
          { id: "p2", label: "B", conditions: [], action: { assignmentType: "USER", assigneeId: "u2", assigneeName: "B" } },
        ],
      })
    )
    const w = review.warnings.find((w) => w.severity === "warning" && w.message.includes("catch-all"))
    expect(w).toBeDefined()
  })

  it("detects overlapping conditions", () => {
    const conds = [makeGroup([makeCond()])]
    const review = routeToEnglish(
      makeState({
        paths: [
          { id: "p1", label: "A", conditions: conds, action: { assignmentType: "USER", assigneeId: "u1", assigneeName: "A" } },
          { id: "p2", label: "B", conditions: conds, action: { assignmentType: "USER", assigneeId: "u2", assigneeName: "B" } },
        ],
      })
    )
    const w = review.warnings.find((w) => w.severity === "warning" && w.message.includes("identical"))
    expect(w).toBeDefined()
  })

  it("detects missing default owner", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          { id: "p1", label: "A", conditions: [makeGroup([makeCond()])], action: { assignmentType: "USER", assigneeId: "u1", assigneeName: "A" } },
        ],
        defaultOwner: null,
      })
    )
    const w = review.warnings.find((w) => w.severity === "warning" && w.message.includes("default owner"))
    expect(w).toBeDefined()
  })

  it("detects no trigger criteria (info)", () => {
    const review = routeToEnglish(makeState({ trigger: defaultTriggerConfig() }))
    const w = review.warnings.find((w) => w.severity === "info" && w.message.includes("trigger criteria"))
    expect(w).toBeDefined()
  })

  it("detects dry run active (info)", () => {
    const review = routeToEnglish(
      makeState({
        trigger: { ...defaultTriggerConfig(), isDryRun: true },
      })
    )
    const w = review.warnings.find((w) => w.severity === "info" && w.message.includes("Dry run"))
    expect(w).toBeDefined()
  })
})

// ── V2 multi-step paths ──────────────────────────────────────────────────

describe("V2 multi-step path sections", () => {
  it("renders steps in order", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "Multi-Step",
            conditions: [],
            action: { assignmentType: null, assigneeId: null, assigneeName: null },
            steps: [
              {
                type: "filter",
                conditions: [makeGroup([makeCond({ fieldApiName: "Industry", operator: "equals", value: "Tech" })])],
              },
              { type: "updateField", fieldApiName: "Status__c", fieldValue: "Routed" },
              { type: "assign", assignmentType: "USER", assigneeId: "u1", assigneeName: "Alice" },
            ],
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    expect(path.lines.some((l) => lt(l).includes("Industry"))).toBe(true)
    expect(path.lines.some((l) => lt(l).includes("Status__c"))).toBe(true)
    expect(path.lines.some((l) => lt(l).includes("Alice"))).toBe(true)
  })

  it("renders path with nested split and sub-path labels", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "Split Path",
            conditions: [],
            action: { assignmentType: null, assigneeId: null, assigneeName: null },
            steps: [
              { type: "filter", conditions: [] },
              {
                type: "split",
                paths: [
                  {
                    id: "sub-a",
                    label: "Enterprise",
                    conditions: [makeGroup([makeCond({ fieldApiName: "Revenue", operator: "gt", value: "1M" })])],
                    action: { assignmentType: "USER", assigneeId: "u1", assigneeName: "Ent Rep" },
                    steps: [
                      {
                        type: "filter",
                        conditions: [makeGroup([makeCond({ fieldApiName: "Revenue", operator: "gt", value: "1M" })])],
                      },
                      { type: "assign", assignmentType: "USER", assigneeId: "u1", assigneeName: "Ent Rep" },
                    ],
                  },
                  {
                    id: "sub-b",
                    label: "SMB",
                    conditions: [],
                    action: { assignmentType: "ROUND_ROBIN", assigneeId: "t1", assigneeName: "SMB Team" },
                    steps: [
                      { type: "filter", conditions: [] },
                      { type: "assign", assignmentType: "ROUND_ROBIN", assigneeId: "t1", assigneeName: "SMB Team" },
                    ],
                  },
                ],
                defaultOwner: null,
              },
            ],
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    // Should mention split
    expect(path.lines.some((l) => lt(l).includes("Split into 2"))).toBe(true)
    // Should render sub-path labels
    expect(path.lines.some((l) => lt(l).includes("Enterprise"))).toBe(true)
    expect(path.lines.some((l) => lt(l).includes("SMB"))).toBe(true)
  })

  it("renders 3-level deep split with depth information", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "Deep Split",
            conditions: [],
            action: { assignmentType: null, assigneeId: null, assigneeName: null },
            steps: [
              { type: "filter", conditions: [] },
              {
                type: "split",
                paths: [
                  {
                    id: "level1",
                    label: "Level 1",
                    conditions: [],
                    action: { assignmentType: null, assigneeId: null, assigneeName: null },
                    steps: [
                      { type: "filter", conditions: [] },
                      {
                        type: "split",
                        paths: [
                          {
                            id: "level2",
                            label: "Level 2",
                            conditions: [makeGroup([makeCond({ fieldApiName: "Size", operator: "gt", value: "100" })])],
                            action: { assignmentType: "USER", assigneeId: "u1", assigneeName: "Deep User" },
                            steps: [
                              {
                                type: "filter",
                                conditions: [makeGroup([makeCond({ fieldApiName: "Size", operator: "gt", value: "100" })])],
                              },
                              { type: "assign", assignmentType: "USER", assigneeId: "u1", assigneeName: "Deep User" },
                            ],
                          },
                        ],
                        defaultOwner: null,
                      },
                    ],
                  },
                ],
                defaultOwner: null,
              },
            ],
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    // Should have lines for split and nested content
    expect(path.lines.length).toBeGreaterThan(1)
    // Should contain the deep path label
    expect(path.lines.some((l) => lt(l).includes("Level 2"))).toBe(true)
    // Should contain the deep condition
    expect(path.lines.some((l) => lt(l).includes("Size"))).toBe(true)

    // Check that EnglishLine depth values are present for nested items
    const englishLines = path.lines.filter((l): l is EnglishLine => typeof l !== "string")
    const maxDepth = Math.max(...englishLines.map((l) => l.depth))
    expect(maxDepth).toBeGreaterThanOrEqual(2)
  })

  it("renders split with defaultOwner fallback line", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "Split With Default",
            conditions: [],
            action: { assignmentType: null, assigneeId: null, assigneeName: null },
            steps: [
              { type: "filter", conditions: [] },
              {
                type: "split",
                paths: [
                  {
                    id: "sub-a",
                    label: "Sub A",
                    conditions: [makeGroup([makeCond()])],
                    action: { assignmentType: "USER", assigneeId: "u1", assigneeName: "A" },
                    steps: [
                      { type: "filter", conditions: [makeGroup([makeCond()])] },
                      { type: "assign", assignmentType: "USER", assigneeId: "u1", assigneeName: "A" },
                    ],
                  },
                ],
                defaultOwner: { assignmentType: "QUEUE", assigneeId: "q1", assigneeName: "Fallback Queue" },
              },
            ],
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    expect(path.lines.some((l) => lt(l).includes("Default") && lt(l).includes("Fallback Queue"))).toBe(true)
  })

  it("path with split but no assign anywhere shows warning", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "No Assign Split",
            conditions: [],
            action: { assignmentType: null, assigneeId: null, assigneeName: null },
            steps: [
              { type: "filter", conditions: [] },
              {
                type: "split",
                paths: [
                  {
                    id: "sub-a",
                    label: "Sub A",
                    conditions: [],
                    action: { assignmentType: null, assigneeId: null, assigneeName: null },
                    steps: [
                      { type: "filter", conditions: [] },
                      { type: "updateField", fieldApiName: "Status", fieldValue: "Pending" },
                      // No assign step anywhere
                    ],
                  },
                ],
                defaultOwner: null,
              },
            ],
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    // hasAssignAnywhere should detect missing assign → warning status
    expect(path.status).toBe("warning")
  })

  it("path with assign inside nested split: buildPathSection uses hasAssignAnywhere (ok status)", () => {
    // hasAssignAnywhere recursively finds assign steps inside nested splits.
    // buildPathSection uses this to determine the section status.
    // NOTE: detectWarnings uses a non-recursive check (p.steps.some), so it still
    // emits a "no assignment step" warning. This is a known inconsistency.
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "Nested Assign",
            conditions: [],
            action: { assignmentType: null, assigneeId: null, assigneeName: null },
            steps: [
              { type: "filter", conditions: [] },
              {
                type: "split",
                paths: [
                  {
                    id: "sub-a",
                    label: "Sub A",
                    conditions: [],
                    action: { assignmentType: "USER", assigneeId: "u1", assigneeName: "Alice" },
                    steps: [
                      { type: "filter", conditions: [] },
                      { type: "assign", assignmentType: "USER", assigneeId: "u1", assigneeName: "Alice" },
                    ],
                  },
                ],
                defaultOwner: null,
              },
            ],
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    // buildPathSection uses hasAssignAnywhere (recursive) → finds the assign in nested split → status ok
    expect(path.status).toBe("ok")

    // detectWarnings uses non-recursive p.steps.some → still flags "no assignment step"
    // This is a known inconsistency between buildPathSection and detectWarnings
    const noAssignWarning = review.warnings.find(
      (w) => w.relatedSection === "path-p1" && w.message.includes("no assignment step")
    )
    expect(noAssignWarning).toBeDefined()
  })

  it("renders createTask step in lines", () => {
    const review = routeToEnglish(
      makeState({
        paths: [
          {
            id: "p1",
            label: "Task Path",
            conditions: [],
            action: { assignmentType: null, assigneeId: null, assigneeName: null },
            steps: [
              { type: "filter", conditions: [] },
              { type: "createTask", subject: "Follow up", priority: "High", status: "Not Started", dueDateOffset: 3, description: "" },
              { type: "assign", assignmentType: "USER", assigneeId: "u1", assigneeName: "Alice" },
            ],
          },
        ],
      })
    )
    const path = review.sections.find((s) => s.type === "path")!
    expect(path.lines.some((l) => lt(l).includes("Follow up") && lt(l).includes("3 days"))).toBe(true)
  })
})

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles empty paths array", () => {
    const review = routeToEnglish(makeState({ paths: [] }))
    expect(review.sections.filter((s) => s.type === "path")).toHaveLength(0)
  })

  it("handles default state", () => {
    const review = routeToEnglish(defaultBuilderState())
    // Default state has no trigger — empty sections
    expect(review.sections).toHaveLength(0)
  })
})

// ── Search trigger helpers ──────────────────────────────────────────────────

function makeSearchTrigger(overrides: Partial<SearchTriggerConfig> = {}): SearchTriggerConfig {
  return {
    triggerName: "",
    objectType: "LEAD",
    searchCriteria: [],
    frequency: "DAILY",
    scheduleTime: "06:00",
    scheduleTimezone: "UTC",
    batchSize: 500,
    searchMaxRecords: null,
    skipRecentlyRouted: false,
    isDryRun: false,
    ...overrides,
  }
}

// ── Search trigger section ──────────────────────────────────────────────────

describe("search trigger section", () => {
  it("renders daily schedule with criteria", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({
          searchCriteria: [makeGroup([makeCond({ fieldApiName: "Industry", operator: "equals", value: "Tech" })])],
        }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section).toBeDefined()
    expect(section.type).toBe("trigger")
    expect(section.lines.some((l) => lt(l).includes("daily") && lt(l).includes("06:00") && lt(l).includes("UTC"))).toBe(true)
    expect(section.lines.some((l) => lt(l).includes("Where"))).toBe(true)
  })

  it("renders one-time (null frequency)", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ frequency: null }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => lt(l).toLowerCase().includes("one-time") || lt(l).toLowerCase().includes("manual run"))).toBe(true)
  })

  it("renders Contact object type", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ objectType: "CONTACT" }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => lt(l).includes("Contacts") || lt(l).includes("Contact"))).toBe(true)
  })

  it("includes dry run line", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ isDryRun: true }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => lt(l).includes("Dry run") || lt(l).includes("dry run"))).toBe(true)
  })

  it("includes skip recently routed", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ skipRecentlyRouted: true }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => lt(l).toLowerCase().includes("skipping records") || lt(l).toLowerCase().includes("skip"))).toBe(true)
  })

  it("includes non-default batch size", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ batchSize: 50 }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => lt(l).includes("Batch size: 50") || lt(l).includes("batch size") && lt(l).includes("50"))).toBe(true)
  })

  it("omits batch size when default (500)", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ batchSize: 500 }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => lt(l).toLowerCase().includes("batch size"))).toBe(false)
  })

  it("not present when searchTrigger is null", () => {
    const review = routeToEnglish(makeState({ searchTrigger: null }))
    expect(review.sections.find((s) => s.id === "search-trigger")).toBeUndefined()
  })

  it("coexists with real-time trigger", () => {
    const review = routeToEnglish(
      makeState({
        trigger: defaultTriggerConfig(),
        searchTrigger: makeSearchTrigger(),
      })
    )
    const realTimeTrigger = review.sections.find((s) => s.type === "trigger" && s.id !== "search-trigger")
    const searchTrigger = review.sections.find((s) => s.id === "search-trigger")
    expect(realTimeTrigger).toBeDefined()
    expect(searchTrigger).toBeDefined()
  })
})

// ── Search trigger warnings ─────────────────────────────────────────────────

describe("search trigger warnings", () => {
  it("warns when no search criteria", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ searchCriteria: [] }),
      })
    )
    const w = review.warnings.find(
      (w) => w.severity === "warning" && w.message.toLowerCase().includes("search criteria")
    )
    expect(w).toBeDefined()
  })

  it("warns when search trigger dry run active", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ isDryRun: true }),
      })
    )
    const w = review.warnings.find(
      (w) => w.severity === "info" && w.message.toLowerCase().includes("dry run")
    )
    expect(w).toBeDefined()
  })
})
