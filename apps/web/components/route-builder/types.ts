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
  batchSize: number                    // 50 | 100 | 200 | 400
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

export interface RouteBuilderState {
  name: string
  routeType: RouteType
  trigger: TriggerConfig | null
  searchTrigger: SearchTriggerConfig | null
  matchConfig: MatchConfig | null
  paths: RoutePath[]
  defaultOwner: DefaultOwner | null
}

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
