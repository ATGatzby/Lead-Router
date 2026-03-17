"use client"

import { useState, useCallback, useRef, useMemo } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  BackgroundVariant,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import { EntryNode, DecisionNode, BranchDecisionNode, MatchNode, AssignmentNode, DefaultNode, UpdateFieldNode, CreateTaskNode, FilterNode } from "./nodes"
import { FlowStepsPanel } from "./panels/FlowStepsPanel"
import { NodeConfigSheet } from "./panels/NodeConfigSheet"
import { FlowToolbar } from "./panels/FlowToolbar"
import { FlowStatusBar } from "./panels/FlowStatusBar"
import { TestRunPanel } from "./panels/TestRunPanel"
import { FlowEnglishView } from "./FlowEnglishView"
import { validateFlow } from "./flow-validation"
import { autoLayout } from "./flow-auto-layout"
import { useFlowHistory } from "./use-flow-history"
import type { FlowNodeData, FlowEdgeData, FlowNodeType, ObjectType, FlowStatus } from "./types"
import type { FieldSchema } from "@/components/condition-builder/types"

const nodeTypes: NodeTypes = {
  ENTRY: EntryNode,
  DECISION: DecisionNode,
  BRANCH_DECISION: BranchDecisionNode,
  MATCH: MatchNode,
  ASSIGNMENT: AssignmentNode,
  DEFAULT: DefaultNode,
  UPDATE_FIELD: UpdateFieldNode,
  CREATE_TASK: CreateTaskNode,
  FILTER: FilterNode,
}

interface FlowBuilderProps {
  flowId: string | null
  initialName: string
  initialNodes: FlowNodeData[]
  initialEdges: FlowEdgeData[]
  objectType: ObjectType
  status: FlowStatus
  fields: FieldSchema[]
  onSave: (data: { name: string; nodes: FlowNodeData[]; edges: FlowEdgeData[]; triggerEvent: string; isDryRun: boolean }) => Promise<void>
  onPublish: () => Promise<void>
}

function FlowBuilderInner({
  flowId, initialName, initialNodes, initialEdges, objectType, status, fields, onSave, onPublish,
}: FlowBuilderProps) {
  const [name, setName] = useState(initialName)
  const [viewMode, setViewMode] = useState<"canvas" | "english">("canvas")
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [testRunOpen, setTestRunOpen] = useState(false)
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<string[]>([])
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { fitView, zoomIn, zoomOut, screenToFlowPosition } = useReactFlow()

  // Convert FlowNodeData[] to ReactFlow Node[]
  const toRFNodes = (fNodes: FlowNodeData[]): Node[] =>
    fNodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: { ...n, config: n.config }, selected: n.id === selectedNodeId }))

  const toRFEdges = (fEdges: FlowEdgeData[]): Edge[] =>
    fEdges.map((e): Edge => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
      label: e.label,
      animated: true,
      style: { stroke: e.label === "True" || e.label === "YES" || e.label === "Found" ? "#22c55e" : e.label === "False" || e.label === "NO" || e.label === "Not Found" || e.label === "None" ? "#ef4444" : "#d4d4d8", strokeWidth: 1.5 },
      labelStyle: { fill: e.label === "True" || e.label === "Found" ? "#22c55e" : e.label === "False" || e.label === "Not Found" ? "#ef4444" : "#a1a1aa", fontSize: 10, fontWeight: 700 },
    }))

  const [nodes, setNodes, onNodesChange] = useNodesState(toRFNodes(initialNodes))
  const [edges, setEdges, onEdgesChange] = useEdgesState(toRFEdges(initialEdges) as Edge[])

  // Highlight path callback for test run panel
  const handleHighlightPath = useCallback((nodeIds: string[]) => {
    setHighlightedNodeIds(nodeIds)
    if (nodeIds.length > 0) {
      setNodes(nds => nds.map(n => ({
        ...n,
        style: nodeIds.includes(n.id)
          ? { boxShadow: "0 0 0 2px #22c55e, 0 0 20px 4px rgba(34,197,94,0.3)", borderRadius: "14px" }
          : { opacity: 0.4 },
      })))
      setEdges(eds => eds.map(e => ({
        ...e,
        animated: nodeIds.includes(e.source) && nodeIds.includes(e.target),
        style: nodeIds.includes(e.source) && nodeIds.includes(e.target)
          ? { stroke: "#22c55e", strokeWidth: 2.5 }
          : { stroke: "#d4d4d8", strokeWidth: 1, opacity: 0.3 },
      })))
    } else {
      setNodes(nds => nds.map(n => ({ ...n, style: undefined })))
      setEdges(eds => eds.map(e => ({
        ...e,
        animated: true,
        style: {
          stroke: typeof e.label === "string" && (e.label === "True" || e.label === "YES" || e.label === "Found") ? "#22c55e"
            : typeof e.label === "string" && (e.label === "False" || e.label === "NO" || e.label === "Not Found" || e.label === "None") ? "#ef4444"
            : "#d4d4d8",
          strokeWidth: 1.5,
          opacity: 1,
        },
      })))
    }
  }, [setNodes, setEdges])

  const { pushHistory, undo, redo, canUndo, canRedo } = useFlowHistory(initialNodes, initialEdges)

  const getFlowNodes = useCallback((): FlowNodeData[] => {
    return nodes.map(n => ({
      id: n.id,
      type: n.type as FlowNodeType,
      label: (n.data as any).label ?? n.type,
      position: n.position,
      config: (n.data as any).config ?? {},
    }))
  }, [nodes])

  const getFlowEdges = useCallback((): FlowEdgeData[] => {
    return edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
      label: typeof e.label === "string" ? e.label : undefined,
    }))
  }, [edges])

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null
    const rfNode = nodes.find(n => n.id === selectedNodeId)
    if (!rfNode) return null
    return {
      id: rfNode.id,
      type: rfNode.type as FlowNodeType,
      label: (rfNode.data as any).label ?? rfNode.type,
      position: rfNode.position,
      config: (rfNode.data as any).config ?? {},
    } as FlowNodeData
  }, [selectedNodeId, nodes])

  const existingTypes = useMemo(() => new Set(nodes.map(n => n.type as FlowNodeType)), [nodes])

  const warnings = useMemo(() => validateFlow(getFlowNodes(), getFlowEdges()), [nodes, edges])

  const onConnect = useCallback((params: Connection) => {
    const newEdge = {
      ...params,
      id: `e-${params.source}-${params.target}-${Date.now()}`,
      animated: true,
      style: { stroke: "#d4d4d8", strokeWidth: 1.5 },
    }
    // @ts-expect-error — React Flow Edge type inference mismatch with addEdge return
    setEdges(eds => addEdge(newEdge, eds))
  }, [setEdges])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
  }, [])

  // Drop handler for steps panel drag — use screenToFlowPosition for accurate placement
  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    const type = event.dataTransfer.getData("application/reactflow-type") as FlowNodeType
    if (!type) return

    // Convert screen coordinates to flow coordinates (accounts for zoom/pan)
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    // Center the node on the drop point
    position.x -= 120
    position.y -= 30

    const newId = `${type.toLowerCase()}-${Date.now()}`

    const newNode: Node = {
      id: newId,
      type,
      position,
      data: { id: newId, type, label: type.replace("_", " "), config: {} },
    }

    setNodes(nds => [...nds, newNode])
    setSelectedNodeId(newId)
  }, [setNodes, screenToFlowPosition])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }, [])

  // Update node config from config sheet
  const onUpdateNodeConfig = useCallback((nodeId: string, config: Record<string, unknown>) => {
    const newLabel = config._label as string | undefined
    const cleanConfig = { ...config }
    delete cleanConfig._label

    setNodes(nds => nds.map(n => {
      if (n.id !== nodeId) return n
      return {
        ...n,
        data: { ...n.data, config: cleanConfig, label: newLabel ?? (n.data as any).label },
      }
    }))
  }, [setNodes])

  const handleAutoLayout = useCallback(() => {
    const flowNodes = getFlowNodes()
    const flowEdges = getFlowEdges()
    const laid = autoLayout(flowNodes, flowEdges)
    setNodes(toRFNodes(laid))
    setTimeout(() => fitView({ padding: 0.2 }), 50)
  }, [getFlowNodes, getFlowEdges, setNodes, fitView])

  const getSavePayload = useCallback(() => {
    const entryNode = getFlowNodes().find(n => n.type === "ENTRY")
    return {
      name,
      nodes: getFlowNodes(),
      edges: getFlowEdges(),
      triggerEvent: (entryNode?.config as any)?.triggerEvent ?? "BOTH",
      isDryRun: false,
    }
  }, [name, getFlowNodes, getFlowEdges])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await onSave(getSavePayload())
    } finally {
      setSaving(false)
    }
  }, [getSavePayload, onSave])

  const handlePublish = useCallback(async () => {
    setPublishing(true)
    try {
      // Auto-save before publishing
      await onSave(getSavePayload())
      await onPublish()
    } finally {
      setPublishing(false)
    }
  }, [getSavePayload, onSave, onPublish])

  return (
    <div className="flex flex-col h-screen bg-white">
      <FlowToolbar
        name={name}
        onNameChange={setName}
        objectType={objectType}
        status={status}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => { const prev = undo(); if (prev) { setNodes(toRFNodes(prev.nodes)); setEdges(toRFEdges(prev.edges)); } }}
        onRedo={() => { const next = redo(); if (next) { setNodes(toRFNodes(next.nodes)); setEdges(toRFEdges(next.edges)); } }}
        onZoomIn={() => zoomIn()}
        onZoomOut={() => zoomOut()}
        onFitView={() => fitView({ padding: 0.2 })}
        onAutoLayout={handleAutoLayout}
        onSave={handleSave}
        onPublish={handlePublish}
        onTestRun={() => setTestRunOpen(true)}
        saving={saving}
        publishing={publishing}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      <div className="flex flex-1 overflow-hidden">
        {viewMode === "canvas" ? (
          <div className="flex-1 relative" ref={reactFlowWrapper}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              onDrop={onDrop}
              onDragOver={onDragOver}
              nodeTypes={nodeTypes}
              fitView
              deleteKeyCode="Backspace"
              className="bg-[#fafafa]"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e0e0e0" />
              <Controls className="!bg-white !border-zinc-200 !shadow-sm [&_button]:!bg-white [&_button]:!border-zinc-200 [&_button]:!text-zinc-500 [&_button:hover]:!bg-zinc-50" />
              <MiniMap
                nodeColor={n => {
                  const colors: Record<string, string> = { ENTRY: "#10b981", DECISION: "#8b5cf6", BRANCH_DECISION: "#8b5cf6", MATCH: "#3b82f6", ASSIGNMENT: "#22c55e", DEFAULT: "#f59e0b", UPDATE_FIELD: "#eab308", CREATE_TASK: "#0ea5e9", FILTER: "#6366f1" }
                  return colors[n.type ?? ""] ?? "#a1a1aa"
                }}
                className="!bg-white/80 !border-zinc-200"
                maskColor="rgba(255,255,255,0.6)"
              />
            </ReactFlow>
          </div>
        ) : (
          <FlowEnglishView nodes={getFlowNodes()} edges={getFlowEdges()} flowName={name} />
        )}

        {/* Right: Steps panel */}
        <FlowStepsPanel existingTypes={existingTypes} />

        {/* Config sheet (slide-over) */}
        <NodeConfigSheet
          node={selectedNode}
          fields={fields}
          onUpdate={onUpdateNodeConfig}
          onClose={() => setSelectedNodeId(null)}
        />

        <TestRunPanel
          open={testRunOpen}
          onClose={() => { setTestRunOpen(false); handleHighlightPath([]) }}
          objectType={objectType}
          nodes={getFlowNodes()}
          onHighlightPath={handleHighlightPath}
        />
      </div>

      <FlowStatusBar warnings={warnings} nodeCount={nodes.length} edgeCount={edges.length} />
    </div>
  )
}

export function FlowBuilder(props: FlowBuilderProps) {
  return (
    <ReactFlowProvider>
      <FlowBuilderInner {...props} />
    </ReactFlowProvider>
  )
}
