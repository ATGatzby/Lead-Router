import type { FlowNodeData, FlowEdgeData } from "@/components/flow-builder/types"
import type { EnglishSection, RouteWarning } from "@/lib/route-to-english"

export interface FlowEnglishReview {
  sections: EnglishSection[]
  warnings: RouteWarning[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPERATOR_LABELS: Record<string, string> = {
  equals: "equals",
  not_equals: "does not equal",
  contains: "contains",
  not_contains: "does not contain",
  starts_with: "starts with",
  gt: "is greater than",
  lt: "is less than",
  gte: "is at least",
  lte: "is at most",
  is_blank: "is blank",
  is_not_blank: "is not blank",
  is_true: "is true",
  is_false: "is false",
  includes: "includes",
  excludes: "excludes",
}

const NO_VALUE_OPS = new Set(["is_blank", "is_not_blank", "is_true", "is_false"])

function conditionToText(c: any): string {
  const field = c.fieldApiName ?? c.fieldName ?? "field"
  const opLabel = OPERATOR_LABELS[c.operator] ?? c.operator ?? "equals"
  if (NO_VALUE_OPS.has(c.operator)) return `${field} ${opLabel}`
  return `${field} ${opLabel} "${c.value ?? ""}"`
}

function conditionGroupToText(group: any): string {
  const conds = group.conditions ?? []
  if (conds.length === 0) return ""
  const parts = conds.map(conditionToText)
  const joiner = group.conjunction === "OR" ? " or " : " and "
  return parts.join(joiner)
}

function conditionsToText(groups: any[]): string {
  if (!Array.isArray(groups) || groups.length === 0) return ""
  const nonEmpty = groups.filter((g: any) => (g.conditions ?? []).length > 0)
  if (nonEmpty.length === 0) return ""
  if (nonEmpty.length === 1) return conditionGroupToText(nonEmpty[0])
  return nonEmpty.map((g: any) => `(${conditionGroupToText(g)})`).join(" or ")
}

function hasConditions(groups: any[]): boolean {
  return Array.isArray(groups) && groups.some((g: any) => (g.conditions ?? []).length > 0)
}

function assignmentLabel(config: any): string {
  const type = config?.assignmentType
  const name = config?.assigneeName || "(not set)"
  const typeLabel = type === "ROUND_ROBIN" ? "round robin" : type === "QUEUE" ? "queue" : "user"
  return `${name} (${typeLabel})`
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

function getOutEdges(nodeId: string, edges: FlowEdgeData[]): FlowEdgeData[] {
  return edges.filter(e => e.source === nodeId)
}

function getNode(nodeId: string, nodes: FlowNodeData[]): FlowNodeData | undefined {
  return nodes.find(n => n.id === nodeId)
}

/** Walk all paths from entry to terminal nodes (ASSIGNMENT / DEFAULT) */
interface TerminalPath {
  breadcrumbs: string[] // human-readable decision trail
  terminalNode: FlowNodeData
  nodeIds: string[]
  midFlowActions: string[] // UPDATE_FIELD / CREATE_TASK descriptions
}

function walkPaths(
  nodeId: string,
  nodes: FlowNodeData[],
  edges: FlowEdgeData[],
  breadcrumbs: string[],
  nodeIds: string[],
  midFlowActions: string[],
  visited: Set<string>,
  results: TerminalPath[]
) {
  if (visited.has(nodeId) || visited.size > 50) return
  visited.add(nodeId)

  const node = getNode(nodeId, nodes)
  if (!node) return

  const outEdges = getOutEdges(nodeId, edges)

  switch (node.type) {
    case "ENTRY": {
      // Skip — breadcrumb added by trigger section
      for (const edge of outEdges) {
        walkPaths(edge.target, nodes, edges, [...breadcrumbs], [...nodeIds, nodeId], [...midFlowActions], new Set(visited), results)
      }
      break
    }

    case "DECISION": {
      const cfg = node.config as any
      const conditions = cfg?.conditions ?? []
      const condText = hasConditions(conditions)
        ? conditionsToText(conditions)
        : node.label || "condition"

      const trueEdge = outEdges.find(e => e.label === "True" || e.label === "YES")
      const falseEdge = outEdges.find(e => e.label === "False" || e.label === "NO")

      if (trueEdge) {
        walkPaths(trueEdge.target, nodes, edges, [...breadcrumbs, `${condText} = Yes`], [...nodeIds, nodeId], [...midFlowActions], new Set(visited), results)
      }
      if (falseEdge) {
        walkPaths(falseEdge.target, nodes, edges, [...breadcrumbs, `${condText} = No`], [...nodeIds, nodeId], [...midFlowActions], new Set(visited), results)
      }
      // If no labeled edges, follow any edge
      if (!trueEdge && !falseEdge) {
        for (const edge of outEdges) {
          walkPaths(edge.target, nodes, edges, [...breadcrumbs, condText], [...nodeIds, nodeId], [...midFlowActions], new Set(visited), results)
        }
      }
      break
    }

    case "BRANCH_DECISION": {
      const cfg = node.config as any
      const fieldName = cfg?.fieldApiName ?? node.label ?? "field"

      for (const edge of outEdges) {
        const branchLabel = edge.label ?? "branch"
        walkPaths(edge.target, nodes, edges, [...breadcrumbs, `${fieldName} = ${branchLabel}`], [...nodeIds, nodeId], [...midFlowActions], new Set(visited), results)
      }
      break
    }

    case "FILTER": {
      const cfg = node.config as any
      const conditions = cfg?.conditions ?? []
      const condText = hasConditions(conditions) ? conditionsToText(conditions) : "filter passes"
      for (const edge of outEdges) {
        walkPaths(edge.target, nodes, edges, [...breadcrumbs, condText], [...nodeIds, nodeId], [...midFlowActions], new Set(visited), results)
      }
      break
    }

    case "MATCH": {
      const cfg = node.config as any
      const objects = [cfg?.checkLeads && "Leads", cfg?.checkContacts && "Contacts", cfg?.checkAccounts && "Accounts"].filter(Boolean)
      const matchLabel = objects.length > 0 ? `${objects.join("/")} match check` : "match check"

      for (const edge of outEdges) {
        walkPaths(edge.target, nodes, edges, [...breadcrumbs, matchLabel], [...nodeIds, nodeId], [...midFlowActions], new Set(visited), results)
      }
      break
    }

    case "UPDATE_FIELD": {
      const cfg = node.config as any
      const action = `Set ${cfg?.fieldApiName ?? "field"} = "${cfg?.fieldValue ?? ""}"`
      for (const edge of outEdges) {
        walkPaths(edge.target, nodes, edges, [...breadcrumbs], [...nodeIds, nodeId], [...midFlowActions, action], new Set(visited), results)
      }
      break
    }

    case "CREATE_TASK": {
      const cfg = node.config as any
      const action = `Create Task: "${cfg?.subject ?? "Task"}"`
      for (const edge of outEdges) {
        walkPaths(edge.target, nodes, edges, [...breadcrumbs], [...nodeIds, nodeId], [...midFlowActions, action], new Set(visited), results)
      }
      break
    }

    case "ASSIGNMENT":
    case "DEFAULT": {
      results.push({
        breadcrumbs,
        terminalNode: node,
        nodeIds: [...nodeIds, nodeId],
        midFlowActions,
      })
      break
    }

    default: {
      // Unknown node type — follow edges
      for (const edge of outEdges) {
        walkPaths(edge.target, nodes, edges, [...breadcrumbs], [...nodeIds, nodeId], [...midFlowActions], new Set(visited), results)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildTriggerSection(entryNode: FlowNodeData): EnglishSection {
  const cfg = entryNode.config as any
  const objLabel = cfg?.objectType === "CONTACT" ? "Contact" : cfg?.objectType === "ACCOUNT" ? "Account" : "Lead"
  const eventLabel = cfg?.triggerEvent === "INSERT" ? "created" : cfg?.triggerEvent === "UPDATE" ? "updated" : "created or updated"
  const lines: string[] = []

  if (hasConditions(cfg?.triggerConditions ?? [])) {
    lines.push(`When a ${objLabel} is ${eventLabel} where ${conditionsToText(cfg.triggerConditions)}`)
  } else {
    lines.push(`When a ${objLabel} is ${eventLabel} \u2014 all ${objLabel}s will be processed`)
  }

  return { id: "trigger", type: "trigger", title: "TRIGGER", lines, status: "ok" }
}

function buildMatchSection(matchNode: FlowNodeData): EnglishSection {
  const cfg = matchNode.config as any
  const lines: string[] = []

  const objects: string[] = []
  if (cfg?.checkLeads) objects.push("Leads")
  if (cfg?.checkContacts) objects.push("Contacts")
  if (cfg?.checkAccounts) objects.push("Accounts")

  const fields: string[] = []
  if (cfg?.matchEmail) fields.push("email")
  if (cfg?.matchPhone) fields.push("phone")
  if (cfg?.matchDomain) fields.push("domain")
  if (cfg?.matchCompanyName) fields.push("company name")

  if (objects.length > 0 && fields.length > 0) {
    lines.push(`Check for matching ${objects.join("/")} by ${fields.join(", ")}`)
  } else if (objects.length > 0) {
    lines.push(`Check for matching ${objects.join("/")}`)
  } else {
    lines.push("Match check configured (no objects selected)")
  }

  if (cfg?.fuzzyMatchMode && cfg.fuzzyMatchMode !== "STRICT") {
    const modeLabel = cfg.fuzzyMatchMode === "FUZZY" ? "fuzzy" : "AI smart"
    lines.push(`Using ${modeLabel} matching`)
  }

  return { id: "match", type: "match", title: "MATCH", lines, status: "ok" }
}

function buildPathSection(path: TerminalPath, index: number): EnglishSection {
  const cfg = path.terminalNode.config as any
  const label = path.terminalNode.label || `Path ${index + 1}`
  const title = `PATH ${index + 1} \u2014 ${label}`
  const id = `path-${path.terminalNode.id}`
  const lines: string[] = []
  let status: EnglishSection["status"] = "ok"

  const hasAssignment = cfg?.assignmentType && cfg?.assigneeId

  // Breadcrumb trail
  if (path.breadcrumbs.length > 0) {
    lines.push(`If ${path.breadcrumbs.join(" \u2192 ")}`)
  } else {
    lines.push("All remaining records")
  }

  // Mid-flow actions
  for (const action of path.midFlowActions) {
    lines.push(`\u2192 ${action}`)
  }

  // Assignment
  if (!hasAssignment) {
    lines.push("\u2192 Assignment not configured")
    status = "error"
  } else {
    lines.push(`\u2192 Assign to ${assignmentLabel(cfg)}`)
  }

  return { id, type: "path", title, lines, status, pathIndex: index }
}

function buildDefaultSection(node: FlowNodeData): EnglishSection {
  const cfg = node.config as any
  const hasAssignment = cfg?.assignmentType && cfg?.assigneeId

  return {
    id: "default",
    type: "default",
    title: "DEFAULT",
    lines: [
      hasAssignment
        ? `If no other path matches, assign to ${assignmentLabel(cfg)}`
        : "Default fallback \u2014 assignment not configured",
    ],
    status: hasAssignment ? "ok" : "error",
  }
}

// ---------------------------------------------------------------------------
// Warning detection
// ---------------------------------------------------------------------------

function detectWarnings(
  nodes: FlowNodeData[],
  edges: FlowEdgeData[],
  paths: TerminalPath[]
): RouteWarning[] {
  const warnings: RouteWarning[] = []

  // No entry node
  if (!nodes.find(n => n.type === "ENTRY")) {
    warnings.push({ severity: "error", message: "No entry node \u2014 flow cannot be triggered" })
    return warnings
  }

  // Entry with no outgoing edges
  const entryNode = nodes.find(n => n.type === "ENTRY")!
  if (getOutEdges(entryNode.id, edges).length === 0) {
    warnings.push({ severity: "error", message: "Entry node has no connections", relatedSection: "trigger" })
  }

  // No terminal paths found
  if (paths.length === 0) {
    warnings.push({ severity: "error", message: "No complete paths \u2014 flow has no assignment or default nodes" })
  }

  // Unconfigured assignments
  for (const path of paths) {
    const cfg = path.terminalNode.config as any
    if (!cfg?.assignmentType || !cfg?.assigneeId) {
      warnings.push({
        severity: "error",
        message: `"${path.terminalNode.label || path.terminalNode.type}" has no assignment configured`,
        relatedSection: `path-${path.terminalNode.id}`,
      })
    }
  }

  // Disconnected nodes
  const reachableIds = new Set<string>()
  function markReachable(nodeId: string) {
    if (reachableIds.has(nodeId)) return
    reachableIds.add(nodeId)
    for (const edge of getOutEdges(nodeId, edges)) {
      markReachable(edge.target)
    }
  }
  markReachable(entryNode.id)

  for (const node of nodes) {
    if (!reachableIds.has(node.id)) {
      warnings.push({
        severity: "warning",
        message: `"${node.label || node.type}" is disconnected and will never be reached`,
      })
    }
  }

  // Decision/Branch nodes with no conditions configured
  for (const node of nodes) {
    if (node.type === "DECISION") {
      const cfg = node.config as any
      if (!hasConditions(cfg?.conditions ?? [])) {
        warnings.push({
          severity: "warning",
          message: `Decision "${node.label || "Decision"}" has no conditions \u2014 will always evaluate to false`,
        })
      }
    }
  }

  // No default node
  if (!nodes.find(n => n.type === "DEFAULT")) {
    warnings.push({
      severity: "info",
      message: "No default fallback node \u2014 unmatched records will not be assigned",
    })
  }

  // Match node is placeholder
  if (nodes.find(n => n.type === "MATCH")) {
    warnings.push({
      severity: "info",
      message: "Match node is a placeholder \u2014 always follows the \"Not Found\" path",
    })
  }

  return warnings
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function flowToEnglish(nodes: FlowNodeData[], edges: FlowEdgeData[]): FlowEnglishReview {
  const sections: EnglishSection[] = []

  // Entry / trigger
  const entryNode = nodes.find(n => n.type === "ENTRY")
  if (!entryNode) {
    return {
      sections: [],
      warnings: [{ severity: "error", message: "No entry node configured" }],
    }
  }

  sections.push(buildTriggerSection(entryNode))

  // Match section (first match node found)
  const matchNode = nodes.find(n => n.type === "MATCH")
  if (matchNode) {
    sections.push(buildMatchSection(matchNode))
  }

  // Walk all paths from entry to terminal nodes
  const terminalPaths: TerminalPath[] = []
  walkPaths(entryNode.id, nodes, edges, [], [], [], new Set(), terminalPaths)

  // Separate DEFAULT paths from ASSIGNMENT paths
  const assignmentPaths = terminalPaths.filter(p => p.terminalNode.type === "ASSIGNMENT")
  const defaultPaths = terminalPaths.filter(p => p.terminalNode.type === "DEFAULT")

  // Add assignment paths as "path" sections
  for (let i = 0; i < assignmentPaths.length; i++) {
    sections.push(buildPathSection(assignmentPaths[i], i))
  }

  // Add default section
  if (defaultPaths.length > 0) {
    sections.push(buildDefaultSection(defaultPaths[0].terminalNode))
  }

  const warnings = detectWarnings(nodes, edges, terminalPaths)

  return { sections, warnings }
}
