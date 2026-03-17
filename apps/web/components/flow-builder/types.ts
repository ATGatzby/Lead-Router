import type { ConditionGroup } from "@/components/condition-builder/types"

// ─── Node Types ──────────────────────────────────────────────────────────────

export type FlowNodeType =
  | "ENTRY"
  | "DECISION"
  | "BRANCH_DECISION"
  | "MATCH"
  | "ASSIGNMENT"
  | "UPDATE_FIELD"
  | "CREATE_TASK"
  | "FILTER"
  | "DEFAULT"

export type ObjectType = "LEAD" | "CONTACT" | "ACCOUNT"
export type TriggerEvent = "INSERT" | "UPDATE" | "BOTH"
export type AssignmentType = "USER" | "ROUND_ROBIN" | "QUEUE"
export type FuzzyMatchMode = "STRICT" | "FUZZY" | "AI_SMART"
export type FlowStatus = "DRAFT" | "ACTIVE" | "INACTIVE"

// ─── Node Config Types ──────────────────────────────────────────────────────

export interface EntryNodeConfig {
  triggerEvent: TriggerEvent
  triggerConditions: ConditionGroup[]
}

export interface DecisionNodeConfig {
  conditions: ConditionGroup[]
}

export interface BranchDecisionNodeConfig {
  fieldApiName: string
  branches: Array<{ label: string; conditions: ConditionGroup[] }>
  defaultLabel: string
}

export interface MatchNodeConfig {
  checkLeads: boolean
  checkContacts: boolean
  checkAccounts: boolean
  matchEmail: boolean
  matchPhone: boolean
  matchDomain: boolean
  matchCompanyName: boolean
  fuzzyMatchMode: FuzzyMatchMode
}

export interface AssignmentNodeConfig {
  assignmentType: AssignmentType
  assigneeId: string
  assigneeName: string
}

export interface UpdateFieldNodeConfig {
  fieldApiName: string
  fieldValue: string
}

export interface CreateTaskNodeConfig {
  subject: string
  priority: "High" | "Normal" | "Low"
  status: "Not Started" | "In Progress" | "Completed"
  dueDateOffset: number | null
  description: string
  assignedTo: "RECORD_OWNER" | "USER" | "QUEUE"
  assigneeId?: string
}

export interface FilterNodeConfig {
  conditions: ConditionGroup[]
}

export type FlowNodeConfig =
  | EntryNodeConfig
  | DecisionNodeConfig
  | BranchDecisionNodeConfig
  | MatchNodeConfig
  | AssignmentNodeConfig
  | UpdateFieldNodeConfig
  | CreateTaskNodeConfig
  | FilterNodeConfig

// ─── Flow State ─────────────────────────────────────────────────────────────

export interface FlowNodeData {
  id: string
  type: FlowNodeType
  label: string
  position: { x: number; y: number }
  config: Record<string, unknown>
}

export interface FlowEdgeData {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
  type?: string
}

export interface FlowBuilderState {
  flowId: string | null
  name: string
  objectType: ObjectType
  triggerEvent: TriggerEvent
  isDryRun: boolean
  status: FlowStatus
  version: number
  nodes: FlowNodeData[]
  edges: FlowEdgeData[]
}

// ─── Node Palette ───────────────────────────────────────────────────────────

export interface NodePaletteItem {
  type: FlowNodeType
  label: string
  description: string
  category: "triggers" | "logic" | "matching" | "actions" | "advanced"
  icon: string
  disabled?: boolean
  badge?: string
}

export const NODE_PALETTE: NodePaletteItem[] = [
  { type: "ENTRY", label: "Entry", description: "Trigger on record event", category: "triggers", icon: "arrow-up" },
  { type: "DECISION", label: "Decision", description: "True/False branch on conditions", category: "logic", icon: "git-branch" },
  { type: "BRANCH_DECISION", label: "Branch", description: "N-way split on field values", category: "logic", icon: "git-fork" },
  { type: "FILTER", label: "Filter", description: "Narrow down records", category: "logic", icon: "filter" },
  { type: "MATCH", label: "Match", description: "Find existing records", category: "matching", icon: "search" },
  { type: "ASSIGNMENT", label: "Assignment", description: "Route to user / team / queue", category: "actions", icon: "user-plus" },
  { type: "DEFAULT", label: "Default", description: "Catch-all fallback", category: "actions", icon: "shield" },
  { type: "UPDATE_FIELD", label: "Update Field", description: "Set a field value mid-flow", category: "actions", icon: "pencil" },
  { type: "CREATE_TASK", label: "Create Task", description: "Create a Salesforce Task", category: "actions", icon: "clipboard-list" },
]

// ─── Validation ─────────────────────────────────────────────────────────────

export interface FlowValidationWarning {
  severity: "error" | "warning" | "info"
  message: string
  nodeId?: string
}
