import type { FlowNodeData, FlowEdgeData, FlowValidationWarning } from "./types"

export function validateFlow(nodes: FlowNodeData[], edges: FlowEdgeData[]): FlowValidationWarning[] {
  const warnings: FlowValidationWarning[] = []

  // Must have exactly one entry node
  const entryNodes = nodes.filter(n => n.type === "ENTRY")
  if (entryNodes.length === 0) {
    warnings.push({ severity: "error", message: "Flow must have an Entry node" })
  } else if (entryNodes.length > 1) {
    warnings.push({ severity: "error", message: "Flow can only have one Entry node", nodeId: entryNodes[1].id })
  }

  // All non-entry nodes must be reachable from entry
  if (entryNodes.length > 0) {
    const reachable = new Set<string>()
    const queue = [entryNodes[0].id]
    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (reachable.has(nodeId)) continue
      reachable.add(nodeId)
      for (const edge of edges) {
        if (edge.source === nodeId && !reachable.has(edge.target)) {
          queue.push(edge.target)
        }
      }
    }
    for (const node of nodes) {
      if (!reachable.has(node.id) && node.type !== "ENTRY") {
        warnings.push({ severity: "warning", message: `"${node.label || node.type}" is disconnected from the flow`, nodeId: node.id })
      }
    }
  }

  // Terminal nodes (ASSIGNMENT, DEFAULT) should not have outgoing edges
  for (const node of nodes) {
    if (node.type === "ASSIGNMENT" || node.type === "DEFAULT") {
      const outEdges = edges.filter(e => e.source === node.id)
      if (outEdges.length > 0) {
        warnings.push({ severity: "warning", message: `"${node.label}" is a terminal node but has outgoing edges`, nodeId: node.id })
      }
      // Check assignment is configured
      const config = node.config as any
      if (!config?.assignmentType || !config?.assigneeId) {
        warnings.push({ severity: "error", message: `"${node.label || node.type}" has no assignment configured`, nodeId: node.id })
      }
    }
  }

  // Decision nodes should have exactly 2 outgoing edges (True/False)
  for (const node of nodes) {
    if (node.type === "DECISION") {
      const outEdges = edges.filter(e => e.source === node.id)
      if (outEdges.length < 2) {
        warnings.push({ severity: "error", message: `"${node.label || "Decision"}" needs both True and False branches connected`, nodeId: node.id })
      }
    }
  }

  // Match nodes should have 2 outgoing edges (Found/Not Found)
  for (const node of nodes) {
    if (node.type === "MATCH") {
      const outEdges = edges.filter(e => e.source === node.id)
      if (outEdges.length < 2) {
        warnings.push({ severity: "error", message: `"${node.label || "Match"}" needs both Found and Not Found branches connected`, nodeId: node.id })
      }
    }
  }

  // All non-terminal nodes should have at least one outgoing edge
  for (const node of nodes) {
    if (node.type !== "ASSIGNMENT" && node.type !== "DEFAULT") {
      const outEdges = edges.filter(e => e.source === node.id)
      if (outEdges.length === 0) {
        warnings.push({ severity: "warning", message: `"${node.label || node.type}" has no outgoing connection`, nodeId: node.id })
      }
    }
  }

  // Check for cycles (DFS)
  const visited = new Set<string>()
  const inStack = new Set<string>()
  function hasCycle(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visited.add(nodeId)
    inStack.add(nodeId)
    for (const edge of edges) {
      if (edge.source === nodeId && hasCycle(edge.target)) return true
    }
    inStack.delete(nodeId)
    return false
  }
  for (const node of nodes) {
    if (hasCycle(node.id)) {
      warnings.push({ severity: "error", message: "Flow contains a cycle — records could loop infinitely" })
      break
    }
  }

  // At least one terminal node must be reachable
  const terminalNodes = nodes.filter(n => n.type === "ASSIGNMENT" || n.type === "DEFAULT")
  if (terminalNodes.length === 0) {
    warnings.push({ severity: "error", message: "Flow has no Assignment or Default node — records won't be assigned" })
  }

  return warnings
}
