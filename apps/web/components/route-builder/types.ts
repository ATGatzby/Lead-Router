import type { ConditionGroup } from "@/components/condition-builder/types"

export type AssignmentType = "USER" | "ROUND_ROBIN" | "QUEUE"
export type ObjectType = "LEAD" | "CONTACT" | "ACCOUNT"
export type TriggerEvent = "INSERT" | "UPDATE" | "BOTH"
export type LeadMatchAction = "SFDC_MERGE" | "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM"
export type ContactMatchAction = "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP"
export type AccountMatchAction = "ASSIGN_TO_OWNER" | "ASSIGN_CUSTOM" | "SKIP"

export interface CustomAssignment {
  assignmentType: AssignmentType
  assigneeId: string
  assigneeName: string
}

export interface MatchConfig {
  checkLeads: boolean
  checkContacts: boolean
  checkAccounts: boolean
  matchEmail: boolean
  matchPhone: boolean
  matchDomain: boolean
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

export interface RouteBuilderState {
  name: string
  trigger: {
    objectType: ObjectType
    triggerEvent: TriggerEvent
    isDryRun: boolean
  }
  matchConfig: MatchConfig | null
  paths: RoutePath[]
  defaultOwner: DefaultOwner | null
}

/** Human-readable label for a trigger event */
export function triggerEventLabel(
  objectType: ObjectType,
  event: TriggerEvent
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

/** Default / empty RouteBuilderState */
export function defaultBuilderState(): RouteBuilderState {
  return {
    name: "Untitled Route",
    trigger: {
      objectType: "LEAD",
      triggerEvent: "INSERT",
      isDryRun: false,
    },
    matchConfig: null,
    paths: [],  // Paths are added via the canvas (drag Filter + Assign from registry)
    defaultOwner: null,
  }
}
