import dagre from "@dagrejs/dagre"
import type { FlowNodeData, FlowEdgeData } from "./types"

const NODE_WIDTH = 220
const NODE_HEIGHT_MAP: Record<string, number> = {
  ENTRY: 80,
  DECISION: 160,
  BRANCH_DECISION: 160,
  MATCH: 120,
  ASSIGNMENT: 90,
  UPDATE_FIELD: 90,
  CREATE_TASK: 90,
  FILTER: 100,
  DEFAULT: 90,
}

export function autoLayout(
  nodes: FlowNodeData[],
  edges: FlowEdgeData[],
  direction: "TB" | "LR" = "TB"
): FlowNodeData[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  })

  for (const node of nodes) {
    const h = NODE_HEIGHT_MAP[node.type] ?? 100
    g.setNode(node.id, { width: NODE_WIDTH, height: h })
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map(node => {
    const pos = g.node(node.id)
    if (!pos) return node
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - (NODE_HEIGHT_MAP[node.type] ?? 100) / 2,
      },
    }
  })
}
