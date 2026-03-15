import { describe, it, expect } from "vitest"
import { routeToEnglish, conditionToText } from "./route-to-english"
import type { RouteBuilderState, SearchTriggerConfig } from "@/components/route-builder/types"
import { defaultBuilderState, defaultTriggerConfig } from "@/components/route-builder/types"
import type { Condition, ConditionGroup } from "@/components/condition-builder/types"

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
    expect(match.lines.some((l) => l.includes("fuzzy"))).toBe(true)
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
    expect(match.lines.some((l) => l.includes("merge records"))).toBe(true)
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
    batchSize: 200,
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
    expect(section.lines.some((l) => l.includes("daily") && l.includes("06:00") && l.includes("UTC"))).toBe(true)
    expect(section.lines.some((l) => l.includes("Where"))).toBe(true)
  })

  it("renders one-time (null frequency)", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ frequency: null }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => l.toLowerCase().includes("one-time") || l.toLowerCase().includes("manual run"))).toBe(true)
  })

  it("renders Contact object type", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ objectType: "CONTACT" }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => l.includes("Contacts") || l.includes("Contact"))).toBe(true)
  })

  it("includes dry run line", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ isDryRun: true }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => l.includes("Dry run") || l.includes("dry run"))).toBe(true)
  })

  it("includes skip recently routed", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ skipRecentlyRouted: true }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => l.toLowerCase().includes("skipping records") || l.toLowerCase().includes("skip"))).toBe(true)
  })

  it("includes non-default batch size", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ batchSize: 50 }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => l.includes("Batch size: 50") || l.includes("batch size") && l.includes("50"))).toBe(true)
  })

  it("omits batch size when default (200)", () => {
    const review = routeToEnglish(
      makeState({
        searchTrigger: makeSearchTrigger({ batchSize: 200 }),
      })
    )
    const section = review.sections.find((s) => s.id === "search-trigger")!
    expect(section.lines.some((l) => l.toLowerCase().includes("batch size"))).toBe(false)
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
