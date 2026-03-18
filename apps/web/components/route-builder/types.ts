import type { ConditionGroup } from "@/components/condition-builder/types"

export type AssignmentType = "USER" | "ROUND_ROBIN" | "QUEUE"
export type ObjectType = "LEAD" | "CONTACT" | "ACCOUNT"
export type TriggerEvent = "INSERT" | "UPDATE" | "BOTH"
export type LeadMatchAction = "SFDC_MERGE" | "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM"
export type ContactMatchAction = "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP"
export type AccountMatchAction = "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP"
export type RouteType = "REALTIME" | "SCHEDULED"
export type ScheduleFrequency = "DAILY" | "WEEKLY" | "MONTHLY"

export interface CustomAssignment {
  assignmentType: AssignmentType
  assigneeId: string
  assigneeName: string
}

export type FuzzyMatchMode = "STRICT" | "FUZZY" | "AI_SMART"

export interface MatchConfig {
  checkLeads: boolean
  checkContacts: boolean
  checkAccounts: boolean
  matchEmail: boolean
  matchPhone: boolean
  matchDomain: boolean
  matchCompanyName: boolean
  fuzzyMatchMode: FuzzyMatchMode
  onLeadMatch: LeadMatchAction
  leadCustomAssignment: CustomAssignment | null
  onContactMatch: ContactMatchAction
  contactCustomAssignment: CustomAssignment | null
  onAccountMatch: AccountMatchAction
  accountCustomAssignment: CustomAssignment | null
}

export interface PathAction {
  assignmentType: AssignmentType | null
  assigneeId: string | null
  assigneeName: string | null
}

export interface RoutePath {
  id: string
  label: string
  conditions: ConditionGroup[]
  action: PathAction
  steps?: PathStep[]  // V2 multi-step branches; if present, overrides conditions + action
}

export interface DefaultOwner {
  assignmentType: AssignmentType
  assigneeId: string
  assigneeName: string
}

export interface SearchTriggerConfig {
  triggerName: string
  objectType: ObjectType
  searchCriteria: ConditionGroup[]
  frequency: ScheduleFrequency | null  // null = one-time
  scheduleTime: string                 // "06:00"
  scheduleTimezone: string             // "UTC"
  batchSize: number                    // 200 | 500 | 1000
  searchMaxRecords: number | null      // null = no limit
  skipRecentlyRouted: boolean
  isDryRun: boolean
}

export interface TriggerConfig {
  triggerName: string
  objectType: ObjectType
  triggerEvent: TriggerEvent
  isDryRun: boolean
  triggerConditions: ConditionGroup[]
}

// ─── Multi-step branch types ──────────────────────────────────────────────
export type PathStepType = "filter" | "updateField" | "createTask" | "assign" | "split"

export interface PathStepFilter {
  type: "filter"
  conditions: ConditionGroup[]
}

export interface PathStepUpdateField {
  type: "updateField"
  fieldApiName: string
  fieldValue: string
}

export interface PathStepCreateTask {
  type: "createTask"
  subject: string
  priority: "High" | "Normal" | "Low"
  status: "Not Started" | "In Progress" | "Completed"
  dueDateOffset: number | null
  description: string
}

export interface PathStepAssign {
  type: "assign"
  assignmentType: AssignmentType | null
  assigneeId: string | null
  assigneeName: string | null
}

export interface PathStepSplit {
  type: "split"
  paths: RoutePath[]            // recursive sub-paths
  defaultOwner: DefaultOwner | null
}

export type PathStep = PathStepFilter | PathStepUpdateField | PathStepCreateTask | PathStepAssign | PathStepSplit

export const MAX_SPLIT_DEPTH = 5

export interface RouteBuilderState {
  name: string
  routeType: RouteType
  trigger: TriggerConfig | null
  searchTrigger: SearchTriggerConfig | null
  matchConfig: MatchConfig | null
  paths: RoutePath[]
  defaultOwner: DefaultOwner | null
}

// ─── Recursive tree helpers ───────────────────────────────────────────────

/** Find a path by ID anywhere in the recursive tree */
export function findPathById(paths: RoutePath[], targetId: string): RoutePath | null {
  for (const path of paths) {
    if (path.id === targetId) return path
    for (const step of (path.steps ?? [])) {
      if (step.type === "split") {
        const found = findPathById(step.paths, targetId)
        if (found) return found
      }
    }
  }
  return null
}

/** Immutably update a path by ID anywhere in the tree */
export function updatePathById(
  paths: RoutePath[],
  targetId: string,
  updater: (p: RoutePath) => RoutePath
): RoutePath[] {
  return paths.map(path => {
    if (path.id === targetId) return updater(path)
    const hasNestedSplit = (path.steps ?? []).some(s => s.type === "split")
    if (!hasNestedSplit) return path
    return {
      ...path,
      steps: (path.steps ?? []).map(step => {
        if (step.type !== "split") return step
        return { ...step, paths: updatePathById(step.paths, targetId, updater) }
      }),
    }
  })
}

/** Remove a path by ID anywhere in the tree */
export function removePathById(paths: RoutePath[], targetId: string): RoutePath[] {
  const filtered = paths.filter(p => p.id !== targetId)
  if (filtered.length !== paths.length) return filtered
  return paths.map(path => {
    const hasNestedSplit = (path.steps ?? []).some(s => s.type === "split")
    if (!hasNestedSplit) return path
    return {
      ...path,
      steps: (path.steps ?? []).map(step => {
        if (step.type !== "split") return step
        return { ...step, paths: removePathById(step.paths, targetId) }
      }),
    }
  })
}

/** Get nesting depth of a path by ID (0 = top-level) */
export function getPathDepth(paths: RoutePath[], targetId: string, depth = 0): number {
  for (const path of paths) {
    if (path.id === targetId) return depth
    for (const step of (path.steps ?? [])) {
      if (step.type === "split") {
        const found = getPathDepth(step.paths, targetId, depth + 1)
        if (found >= 0) return found
      }
    }
  }
  return -1
}

/** Update a split step identified by parentPathId + stepIndex */
export function updateSplitStep(
  paths: RoutePath[],
  parentPathId: string,
  stepIndex: number,
  updater: (split: PathStepSplit) => PathStepSplit
): RoutePath[] {
  return updatePathById(paths, parentPathId, (p) => ({
    ...p,
    steps: (p.steps ?? []).map((step, i) => {
      if (i !== stepIndex || step.type !== "split") return step
      return updater(step)
    }),
  }))
}

/** Flatten all paths in the tree into a flat list with metadata */
export interface FlatPath {
  path: RoutePath
  depth: number
  parentPathId?: string
  parentStepIndex?: number
}

export function flattenAllPaths(paths: RoutePath[], depth = 0, parentPathId?: string, parentStepIndex?: number): FlatPath[] {
  const result: FlatPath[] = []
  for (const path of paths) {
    result.push({ path, depth, parentPathId, parentStepIndex })
    for (let si = 0; si < (path.steps ?? []).length; si++) {
      const step = (path.steps ?? [])[si]
      if (step.type === "split") {
        result.push(...flattenAllPaths(step.paths, depth + 1, path.id, si))
      }
    }
  }
  return result
}

/** Collect all split steps in the tree */
export interface FlatSplit {
  parentPathId: string
  stepIndex: number
  split: PathStepSplit
  depth: number
}

export function flattenAllSplits(paths: RoutePath[], depth = 0): FlatSplit[] {
  const result: FlatSplit[] = []
  for (const path of paths) {
    for (let si = 0; si < (path.steps ?? []).length; si++) {
      const step = (path.steps ?? [])[si]
      if (step.type === "split") {
        result.push({ parentPathId: path.id, stepIndex: si, split: step, depth: depth + 1 })
        result.push(...flattenAllSplits(step.paths, depth + 1))
      }
    }
  }
  return result
}

// ─── Existing helpers ─────────────────────────────────────────────────────

/** Human-readable label for a trigger event */
export function triggerEventLabel(
  objectType: ObjectType,
  event: TriggerEvent,
): string {
  const obj = objectType === "LEAD" ? "Lead" : objectType === "CONTACT" ? "Contact" : "Account"
  switch (event) {
    case "INSERT":
      return `${obj} Created`
    case "UPDATE":
      return `${obj} Updated`
    case "BOTH":
      return `Any ${obj} Change`
  }
}

/** Default trigger config for newly-added real-time trigger */
export function defaultTriggerConfig(): TriggerConfig {
  return {
    triggerName: "",
    objectType: "LEAD",
    triggerEvent: "INSERT",
    isDryRun: false,
    triggerConditions: [],
  }
}

/** Default / empty RouteBuilderState */
export function defaultBuilderState(): RouteBuilderState {
  return {
    name: "Untitled Route",
    routeType: "REALTIME",
    trigger: null,
    searchTrigger: null,
    matchConfig: null,
    paths: [],
    defaultOwner: null,
  }
}

/** Resolve the active object type from whichever trigger is present */
export function resolveObjectType(state: RouteBuilderState): ObjectType {
  return state.trigger?.objectType ?? state.searchTrigger?.objectType ?? "LEAD"
}

/** Convert legacy RoutePath (conditions + action) to V2 with steps[] */
export function migratePathToSteps(path: RoutePath): PathStep[] {
  return [
    { type: "filter", conditions: path.conditions },
    {
      type: "assign",
      assignmentType: path.action.assignmentType,
      assigneeId: path.action.assigneeId,
      assigneeName: path.action.assigneeName
    },
  ]
}

/** Ensure all paths have steps[] populated (recursive) */
export function migrateStateToV2(state: RouteBuilderState): RouteBuilderState {
  return {
    ...state,
    paths: migratePaths(state.paths),
  }
}

function migratePaths(paths: RoutePath[]): RoutePath[] {
  return paths.map(p => ({
    ...p,
    steps: (p.steps ?? migratePathToSteps(p)).map(step => {
      if (step.type === "split") {
        return { ...step, paths: migratePaths(step.paths) }
      }
      return step
    }),
  }))
}
