"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { useTheme } from "next-themes"
import { Zap, Search, Filter, UserCheck, AlertTriangle, X, Save, ZoomIn, ZoomOut, Maximize2, RotateCcw, FileText, Play, Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StepRegistry, type CanvasNodeType } from "./StepRegistry"
import { TriggerConfigSheet } from "./config/TriggerConfigSheet"
import { SearchTriggerConfigSheet } from "./config/SearchTriggerConfigSheet"
import { MatchConfigSheet, defaultMatchConfig } from "./config/MatchConfigSheet"
import { FilterConfigSheet } from "./config/FilterConfigSheet"
import { ActionConfigSheet } from "./config/ActionConfigSheet"
import { DefaultOwnerConfigSheet } from "./config/DefaultOwnerConfigSheet"
import type {
  RouteBuilderState,
  MatchConfig,
  DefaultOwner,
  PathAction,
  SearchTriggerConfig,
} from "./types"
import { defaultBuilderState, defaultTriggerConfig, triggerEventLabel, resolveObjectType } from "./types"
import type { RuleConditions } from "@/components/condition-builder"
import { EnglishView } from "./EnglishView"
import { routeToEnglish } from "@/lib/route-to-english"
import { RunPanel, type RunningStep } from "./RunPanel"
import { AIRouteGenerator } from "./AIRouteGenerator"

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_WIDTH = 220
const NODE_HEIGHT = 72
const TOP_BAR_HEIGHT = 56
const FILTER_GAP = NODE_WIDTH + 40   // horizontal gap between parallel path columns

// Zoom/pan constants
const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1
const ZOOM_WHEEL_SENSITIVITY = 0.001

// ─── Canvas node / edge types ─────────────────────────────────────────────────

interface CanvasNode {
  id: string
  type: CanvasNodeType
  x: number
  y: number
  pathId?: string  // links filter/assign nodes to a RoutePath
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config?: any
}

interface CanvasEdge {
  fromId: string
  toId: string
}

// ─── Active sheet type ────────────────────────────────────────────────────────

type ActiveSheet =
  | { type: "trigger"; nodeId: string }
  | { type: "searchTrigger"; nodeId: string }
  | { type: "match"; nodeId: string }
  | { type: "filter"; nodeId: string; pathId: string }
  | { type: "assign"; nodeId: string; pathId: string }
  | { type: "defaultOwner"; nodeId: string }
  | null

// ─── Props ────────────────────────────────────────────────────────────────────

interface RouteBuilderProps {
  initialState?: Partial<RouteBuilderState>
  ruleId?: string
  onSave: (state: RouteBuilderState) => Promise<void>
  isSaving?: boolean
}

// ─── Node colour / icon helpers ───────────────────────────────────────────────

const NODE_META: Record<
  CanvasNodeType,
  { icon: React.ElementType; label: string; borderClass: string; iconBg: string; iconColor: string }
> = {
  trigger: {
    icon: Zap,
    label: "Trigger",
    borderClass: "border-l-4 border-l-violet-500",
    iconBg: "bg-violet-100 dark:bg-violet-900",
    iconColor: "text-violet-600 dark:text-violet-400",
  },
  searchTrigger: {
    icon: Search,
    label: "Search Salesforce",
    borderClass: "border-l-4 border-l-teal-500",
    iconBg: "bg-teal-100 dark:bg-teal-900",
    iconColor: "text-teal-600 dark:text-teal-400",
  },
  match: {
    icon: Search,
    label: "Match",
    borderClass: "border-l-4 border-l-blue-500",
    iconBg: "bg-blue-100 dark:bg-blue-900",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  filter: {
    icon: Filter,
    label: "Filter",
    borderClass: "border-l-4 border-l-indigo-500",
    iconBg: "bg-indigo-100 dark:bg-indigo-900",
    iconColor: "text-indigo-600 dark:text-indigo-400",
  },
  assign: {
    icon: UserCheck,
    label: "Assign",
    borderClass: "border-l-4 border-l-green-500",
    iconBg: "bg-green-100 dark:bg-green-900",
    iconColor: "text-green-600 dark:text-green-400",
  },
  defaultOwner: {
    icon: AlertTriangle,
    label: "Default Owner",
    borderClass: "border-l-4 border-l-amber-500",
    iconBg: "bg-amber-100 dark:bg-amber-900",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
}

// ─── Derive edges from nodes ───────────────────────────────────────────────────
//
// Layout: trigger → match? → [filter-A, filter-B, ...] → [assign-A, assign-B, ...] → defaultOwner?
//
function computeEdges(nodes: CanvasNode[]): CanvasEdge[] {
  const edges: CanvasEdge[] = []
  const trigger = nodes.find((n) => n.type === "trigger")
  const searchTrigger = nodes.find((n) => n.type === "searchTrigger")
  const match = nodes.find((n) => n.type === "match")
  // Both triggers fan-out to match (or to the first action node)
  const firstAction = match ?? nodes.find((n) => n.type === "filter") ?? nodes.find((n) => n.type === "defaultOwner")
  if (trigger && firstAction) edges.push({ fromId: trigger.id, toId: firstAction.id })
  if (searchTrigger && firstAction) edges.push({ fromId: searchTrigger.id, toId: firstAction.id })
  const splitNode = match ?? trigger ?? searchTrigger
  if (!splitNode) return edges

  const filterNodes = nodes.filter((n) => n.type === "filter")
  const assignNodes = nodes.filter((n) => n.type === "assign")
  const defaultOwnerNode = nodes.find((n) => n.type === "defaultOwner")

  // Fan-out: splitNode → each filter
  for (const f of filterNodes) {
    edges.push({ fromId: splitNode.id, toId: f.id })
  }
  // filter → assign (matched by pathId)
  for (const f of filterNodes) {
    const a = assignNodes.find((n) => n.pathId === f.pathId)
    if (a) edges.push({ fromId: f.id, toId: a.id })
  }
  // Fan-in: each assign → defaultOwner; or splitNode → defaultOwner when no paths
  if (defaultOwnerNode) {
    if (assignNodes.length > 0) {
      for (const a of assignNodes) {
        edges.push({ fromId: a.id, toId: defaultOwnerNode.id })
      }
    } else {
      edges.push({ fromId: splitNode.id, toId: defaultOwnerNode.id })
    }
  }
  return edges
}

// ─── Build a subtitle string for each node type ───────────────────────────────

function nodeSubtitle(node: CanvasNode, state: RouteBuilderState): string {
  switch (node.type) {
    case "trigger": {
      if (!state.trigger) return "Not configured"
      const base = state.trigger.triggerName || triggerEventLabel(state.trigger.objectType, state.trigger.triggerEvent)
      const criteriaCount = Array.isArray(state.trigger.triggerConditions)
        ? state.trigger.triggerConditions.flatMap((g: any) => Array.isArray(g?.conditions) ? g.conditions : [g]).length
        : 0
      return criteriaCount > 0 ? `${base} · ${criteriaCount} criteria` : base
    }
    case "searchTrigger": {
      if (!state.searchTrigger) return "Not configured"
      const freq = state.searchTrigger.frequency ? state.searchTrigger.frequency.charAt(0) + state.searchTrigger.frequency.slice(1).toLowerCase() : "One-time"
      const obj = state.searchTrigger.objectType === "LEAD" ? "Lead" : state.searchTrigger.objectType === "CONTACT" ? "Contact" : "Account"
      const criteriaCount = Array.isArray(state.searchTrigger.searchCriteria)
        ? state.searchTrigger.searchCriteria.flatMap((g: any) => Array.isArray(g?.conditions) ? g.conditions : [g]).length
        : 0
      return criteriaCount > 0 ? `${freq} · ${obj} · ${criteriaCount} criteria` : `${freq} · ${obj}`
    }
    case "match": {
      if (!state.matchConfig) return "Not configured"
      const checks: string[] = []
      if (state.matchConfig.checkLeads) checks.push("Leads")
      if (state.matchConfig.checkContacts) checks.push("Contacts")
      if (state.matchConfig.checkAccounts) checks.push("Accounts")
      return checks.length > 0 ? `Checks ${checks.join(", ")}` : "No checks selected"
    }
    case "filter": {
      const path = state.paths.find((p) => p.id === node.pathId)
      if (!path) return "No path"
      const allConds = Array.isArray(path.conditions) ? path.conditions.flatMap((g: any) => Array.isArray(g?.conditions) ? g.conditions : []) : []
      const count = allConds.length
      if (count === 0) return "No conditions (catch-all)"
      const first = allConds[0]
      const preview = `${first.fieldApiName} ${first.operator}${first.value ? ` ${first.value}` : ""}`
      return count === 1 ? preview : `${preview} +${count - 1} more`
    }
    case "assign": {
      const path = state.paths.find((p) => p.id === node.pathId)
      if (!path) return "No path"
      if (!path.action.assignmentType) return "Not configured"
      const type =
        path.action.assignmentType === "USER"
          ? "User"
          : path.action.assignmentType === "ROUND_ROBIN"
          ? "Round Robin"
          : "Queue"
      return path.action.assigneeName ? `${type}: ${path.action.assigneeName}` : type
    }
    case "defaultOwner": {
      if (!state.defaultOwner) return "Not configured"
      const type =
        state.defaultOwner.assignmentType === "USER"
          ? "User"
          : state.defaultOwner.assignmentType === "ROUND_ROBIN"
          ? "Round Robin"
          : "Queue"
      return state.defaultOwner.assigneeName
        ? `${type}: ${state.defaultOwner.assigneeName}`
        : type
    }
  }
}

// ─── SVG Edge component ───────────────────────────────────────────────────────

interface EdgeProps {
  fromNode: CanvasNode
  toNode: CanvasNode
}

function Edge({ fromNode, toNode }: EdgeProps) {
  const sx = fromNode.x + NODE_WIDTH / 2
  const sy = fromNode.y + NODE_HEIGHT
  const tx = toNode.x + NODE_WIDTH / 2
  const ty = toNode.y
  const cp1y = sy + 60
  const cp2y = ty - 60
  const d = `M ${sx} ${sy} C ${sx} ${cp1y}, ${tx} ${cp2y}, ${tx} ${ty}`
  return (
    <path
      d={d}
      stroke="#94a3b8"
      strokeWidth={2}
      fill="none"
      strokeLinecap="round"
    />
  )
}

// ─── Single canvas node component ────────────────────────────────────────────

interface CanvasNodeCardProps {
  node: CanvasNode
  title?: string                             // override header label (filter nodes show path label)
  subtitle: string
  isDragging: boolean
  glowState?: "running" | "done" | null      // run-time glow
  onMouseDown: (e: React.MouseEvent, nodeId: string) => void
  onClick: (nodeId: string) => void
  onDelete: (nodeId: string) => void
  onTitleChange?: (title: string) => void    // only for filter nodes
}

function CanvasNodeCard({
  node,
  title,
  subtitle,
  isDragging,
  glowState,
  onMouseDown,
  onClick,
  onDelete,
  onTitleChange,
}: CanvasNodeCardProps) {
  const meta = NODE_META[node.type]
  const Icon = meta.icon
  const displayTitle = title ?? meta.label

  return (
    <div
      data-canvas-node
      style={{
        position: "absolute",
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        zIndex: isDragging ? 50 : 10,
        userSelect: "none",
      }}
      className={[
        "rounded-lg border bg-white dark:bg-[#12121a] shadow-sm flex items-center gap-3 px-3 transition-shadow duration-300",
        meta.borderClass,
        isDragging ? "shadow-lg ring-2 ring-primary/30 cursor-grabbing" : "cursor-grab hover:shadow-md",
        glowState === "running" ? "ring-2 ring-teal-300 dark:ring-teal-600 shadow-lg shadow-teal-100/50 dark:shadow-teal-900/50" : "",
        glowState === "done" ? "ring-2 ring-green-200 dark:ring-green-700" : "",
      ].join(" ")}
      onMouseDown={(e) => onMouseDown(e, node.id)}
      onClick={(e) => {
        e.stopPropagation()
        onClick(node.id)
      }}
    >
      {/* Icon */}
      <div
        className={[
          "flex-shrink-0 flex items-center justify-center size-8 rounded-md",
          meta.iconBg,
          meta.iconColor,
        ].join(" ")}
      >
        <Icon className="size-4" />
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        {onTitleChange ? (
          <input
            type="text"
            value={displayTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="text-sm font-medium bg-transparent border-none outline-none w-full leading-tight p-0 focus:ring-0"
            aria-label="Path name"
          />
        ) : (
          <p className="text-sm font-medium leading-tight truncate">{displayTitle}</p>
        )}
        <p className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">
          {subtitle}
        </p>
      </div>

      {/* Delete button */}
      <button
          type="button"
          className="flex-shrink-0 flex items-center justify-center size-5 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            onDelete(node.id)
          }}
          aria-label={`Remove ${meta.label} node`}
        >
          <X className="size-3" />
        </button>
    </div>
  )
}

// ─── Canvas initialisation from existing state ───────────────────────────────
//
// Builds nodes from the loaded route data (no-op for new routes with no paths).
//
function buildNodesFromState(initialState?: Partial<RouteBuilderState>): CanvasNode[] {
  const hasTrigger = !!initialState?.trigger
  const hasSearchTrigger = !!initialState?.searchTrigger
  const bothTriggers = hasTrigger && hasSearchTrigger
  const nodes: CanvasNode[] = []

  if (hasTrigger) {
    nodes.push({ id: "trigger", type: "trigger", x: bothTriggers ? 180 : 300, y: 120 })
  }
  if (hasSearchTrigger) {
    nodes.push({ id: "searchTrigger", type: "searchTrigger", x: bothTriggers ? 440 : 300, y: 120 })
  }
  const matchConfig = initialState?.matchConfig
  const paths = initialState?.paths ?? []
  const defaultOwner = initialState?.defaultOwner

  let splitY = 120
  if (matchConfig) {
    splitY += 140
    nodes.push({ id: "match", type: "match", x: 300, y: splitY })
  }

  if (paths.length > 0) {
    const filterY = splitY + 140
    paths.forEach((path, i) => {
      const filterX = 300 + i * FILTER_GAP
      nodes.push({ id: `path-filter-${i}`, type: "filter", x: filterX, y: filterY, pathId: path.id })
      nodes.push({ id: `path-assign-${i}`, type: "assign", x: filterX, y: filterY + 140, pathId: path.id })
    })
    if (defaultOwner) {
      const avgX = Math.round(
        paths.reduce((sum, _, i) => sum + 300 + i * FILTER_GAP, 0) / paths.length
      )
      nodes.push({ id: "defaultOwner", type: "defaultOwner", x: avgX, y: filterY + 280 })
    }
  } else if (defaultOwner) {
    nodes.push({ id: "defaultOwner", type: "defaultOwner", x: 300, y: splitY + 140 })
  }

  return nodes
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RouteBuilder({
  initialState,
  ruleId: _ruleId,
  onSave,
  isSaving: externalIsSaving,
}: RouteBuilderProps) {
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  // ── Builder state (the source of truth for the route data) ─────────────────
  const base = defaultBuilderState()
  const [state, setState] = useState<RouteBuilderState>(() => ({
    ...base,
    ...initialState,
    trigger: initialState?.trigger
      ? { ...defaultTriggerConfig(), ...initialState.trigger }
      : null,
    paths: initialState?.paths ?? base.paths,
  }))

  const [savedState, setSavedState] = useState<RouteBuilderState>(state)
  const [internalIsSaving, setInternalIsSaving] = useState(false)
  const isSaving = externalIsSaving ?? internalIsSaving
  const [saveError, setSaveError] = useState<string | null>(null)
  const isDirty = JSON.stringify(state) !== JSON.stringify(savedState)

  // ── AI generator state ─────────────────────────────────────────────────────
  const aiEnabled = true
  const [showAIGenerator, setShowAIGenerator] = useState(false)

  // Auto-open AI panel when ?ai=1 is in URL (must be in useEffect for SSR safety)
  useEffect(() => {
    if (aiEnabled && new URLSearchParams(window.location.search).get("ai") === "1") {
      setShowAIGenerator(true)
    }
  }, [aiEnabled])
  const handleApplyAIRoute = useCallback((aiState: RouteBuilderState) => {
    setState(aiState)
    // Rebuild canvas nodes from the new state
    setNodes(buildNodesFromState(aiState))
    setShowAIGenerator(false)
  }, [])

  // ── Run panel state ────────────────────────────────────────────────────────
  const [showRunPanel, setShowRunPanel] = useState(false)
  const [runningStep, setRunningStep] = useState<RunningStep>(null)
  const [isRunActive, setIsRunActive] = useState(false)
  const [doneSteps, setDoneSteps] = useState<Set<RunningStep>>(new Set())

  // Track which steps have completed for glow
  const handleRunningStepChange = useCallback((step: RunningStep) => {
    setRunningStep((prev) => {
      // When a step transitions away, mark it as done
      if (prev && prev !== step) {
        setDoneSteps((ds) => new Set(ds).add(prev))
      }
      return step
    })
  }, [])

  const handleRunStateChange = useCallback((running: boolean) => {
    setIsRunActive(running)
    if (!running) {
      // Clear all glows after 2 seconds
      setTimeout(() => {
        setDoneSteps(new Set())
        setRunningStep(null)
      }, 2000)
    } else {
      // Starting a new run — clear previous done steps
      setDoneSteps(new Set())
    }
  }, [])

  // Compute glow state for a canvas node type
  const glowForNode = useCallback((nodeType: CanvasNodeType): "running" | "done" | null => {
    // Map canvas node types to RunningStep values
    const typeToStep: Record<string, RunningStep> = {
      trigger: "trigger",
      searchTrigger: "trigger",
      match: "match",
      filter: "filter",
      assign: "assign",
      defaultOwner: "assign", // default owner glows with assign step
    }
    const step = typeToStep[nodeType]
    if (!step) return null
    if (runningStep === step) return "running"
    if (doneSteps.has(step)) return "done"
    return null
  }, [runningStep, doneSteps])

  // ── Canvas / English tab toggle ────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"canvas" | "english">("canvas")

  // ── Canvas nodes — edges are derived automatically ──────────────────────────
  const [nodes, setNodes] = useState<CanvasNode[]>(() => buildNodesFromState(initialState))
  const edges = useMemo(() => computeEdges(nodes), [nodes])

  // ── Sheet state ─────────────────────────────────────────────────────────────
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null)
  const closeSheet = useCallback(() => setActiveSheet(null), [])

  // ── Drag state (node repositioning inside canvas) ───────────────────────────
  const dragRef = useRef<{
    nodeId: string
    startMouseX: number
    startMouseY: number
    startNodeX: number
    startNodeY: number
    hasMoved: boolean
  } | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)

  // ── Zoom / pan state ──────────────────────────────────────────────────────
  const [scale, setScale] = useState(1)
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)

  // Keep refs in sync so native event listeners always read current values
  const panXRef = useRef(panX)
  const panYRef = useRef(panY)
  useEffect(() => { panXRef.current = panX }, [panX])
  useEffect(() => { panYRef.current = panY }, [panY])

  // Pan via middle-click drag or space+left-click
  const panRef = useRef<{
    startMouseX: number
    startMouseY: number
    startPanX: number
    startPanY: number
  } | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const spaceHeldRef = useRef(false)

  // Space key tracking for space+drag pan
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        spaceHeldRef.current = true
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeldRef.current = false
      }
    }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [])

  // Wheel handler — Ctrl/Cmd+wheel = zoom (centered on cursor), plain wheel = no-op (let page scroll naturally)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Only zoom on pinch (ctrlKey is true for trackpad pinch) or Cmd/Ctrl+scroll
    if (!e.ctrlKey && !e.metaKey) return

    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const cursorX = e.clientX - rect.left
    const cursorY = e.clientY - rect.top

    const worldX = (cursorX - panX) / scale
    const worldY = (cursorY - panY) / scale

    const delta = -e.deltaY * ZOOM_WHEEL_SENSITIVITY
    const newScale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale * (1 + delta)))

    const newPanX = cursorX - worldX * newScale
    const newPanY = cursorY - worldY * newScale

    setScale(newScale)
    setPanX(newPanX)
    setPanY(newPanY)
  }, [scale, panX, panY])

  // Canvas pan — mouse down on empty canvas starts panning
  const handleCanvasPanStart = useCallback((e: React.MouseEvent) => {
    // Skip if clicking on a node (let node drag handle it)
    const target = e.target as HTMLElement
    if (target.closest("[data-canvas-node]")) return

    if (e.button === 0 || e.button === 1) {
      e.preventDefault()
      panRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPanX: panXRef.current,
        startPanY: panYRef.current,
      }
      setIsPanning(true)
    }
  }, [])

  // Pan move / up (window-level)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panRef.current) return
      const dx = e.clientX - panRef.current.startMouseX
      const dy = e.clientY - panRef.current.startMouseY
      setPanX(panRef.current.startPanX + dx)
      setPanY(panRef.current.startPanY + dy)
    }
    const onUp = () => {
      panRef.current = null
      setIsPanning(false)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  // Zoom control helpers
  const zoomIn = useCallback(() => {
    setScale((s) => Math.min(MAX_ZOOM, s + ZOOM_STEP))
  }, [])
  const zoomOut = useCallback(() => {
    setScale((s) => Math.max(MIN_ZOOM, s - ZOOM_STEP))
  }, [])
  const resetZoom = useCallback(() => {
    setScale(1)
    setPanX(0)
    setPanY(0)
  }, [])
  const fitToView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || nodes.length === 0) return
    const rect = canvas.getBoundingClientRect()
    const minNodeX = Math.min(...nodes.map((n) => n.x))
    const minNodeY = Math.min(...nodes.map((n) => n.y))
    const maxNodeX = Math.max(...nodes.map((n) => n.x + NODE_WIDTH))
    const maxNodeY = Math.max(...nodes.map((n) => n.y + NODE_HEIGHT))
    const contentW = maxNodeX - minNodeX + 80 // padding
    const contentH = maxNodeY - minNodeY + 80
    const scaleX = rect.width / contentW
    const scaleY = rect.height / contentH
    const newScale = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_ZOOM), MAX_ZOOM)
    const newPanX = (rect.width - contentW * newScale) / 2 - minNodeX * newScale + 40 * newScale
    const newPanY = (rect.height - contentH * newScale) / 2 - minNodeY * newScale + 40 * newScale
    setScale(newScale)
    setPanX(newPanX)
    setPanY(newPanY)
  }, [nodes])

  // ── Node drag handlers ──────────────────────────────────────────────────────
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    // If space is held, let the canvas pan handler take over
    if (spaceHeldRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    dragRef.current = {
      nodeId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      hasMoved: false,
    }
  }, [nodes])

  // We need scale in the drag effect but don't want to re-register listeners on every scale change
  const scaleRef = useRef(scale)
  useEffect(() => { scaleRef.current = scale }, [scale])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const dx = (e.clientX - dragRef.current.startMouseX) / scaleRef.current
      const dy = (e.clientY - dragRef.current.startMouseY) / scaleRef.current
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        dragRef.current.hasMoved = true
      }
      const newX = dragRef.current.startNodeX + dx
      const newY = dragRef.current.startNodeY + dy
      setNodes((prev) =>
        prev.map((n) =>
          n.id === dragRef.current!.nodeId ? { ...n, x: newX, y: newY } : n
        )
      )
    }

    const handleMouseUp = () => {
      dragRef.current = null
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [])

  // ── Node click → open sheet ─────────────────────────────────────────────────
  const handleNodeClick = useCallback((nodeId: string) => {
    if (dragRef.current?.hasMoved) return
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    if ((node.type === "filter" || node.type === "assign") && node.pathId) {
      setActiveSheet({ type: node.type, nodeId: node.id, pathId: node.pathId })
    } else if (node.type === "trigger" || node.type === "searchTrigger" || node.type === "match" || node.type === "defaultOwner") {
      setActiveSheet({ type: node.type, nodeId: node.id })
    }
  }, [nodes])

  // ── Convert screen coords to canvas (world) coords ─────────────────────────
  const screenToCanvas = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: clientX, y: clientY }
    const rect = canvas.getBoundingClientRect()
    return {
      x: (clientX - rect.left - panX) / scale,
      y: (clientY - rect.top - panY) / scale,
    }
  }, [scale, panX, panY])

  // ── Drop from registry onto canvas ─────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const stepType = e.dataTransfer.getData("stepType") as CanvasNodeType | ""
      if (!stepType) return

      const newId = `${stepType}-${Date.now()}`

      // ── Real-Time Trigger: singleton ──────────────────────────────────────────
      if (stepType === "trigger") {
        const existing = nodes.find((n) => n.type === "trigger")
        if (existing) return // singleton
        const searchNode = nodes.find((n) => n.type === "searchTrigger")

        if (searchNode) {
          // Place beside search trigger, shift search right
          setNodes((prev) => [
            ...prev.map((n) =>
              n.type === "searchTrigger" ? { ...n, x: n.x + (NODE_WIDTH / 2 + 20) } : n
            ),
            { id: newId, type: "trigger" as CanvasNodeType, x: searchNode.x - (NODE_WIDTH / 2 + 20), y: searchNode.y },
          ])
        } else {
          setNodes((prev) => [
            ...prev,
            { id: newId, type: "trigger" as CanvasNodeType, x: 300, y: 120 },
          ])
        }

        setState((s) => ({ ...s, trigger: defaultTriggerConfig() }))
        setActiveSheet({ type: "trigger", nodeId: newId })
        return
      }

      // ── Search Salesforce Trigger: place beside real-time trigger ────────────
      if (stepType === "searchTrigger") {
        const triggerNode = nodes.find((n) => n.type === "trigger")
        const existing = nodes.find((n) => n.type === "searchTrigger")
        if (existing) return // singleton

        const siblingX = triggerNode?.x ?? 300
        const siblingY = triggerNode?.y ?? 120

        if (triggerNode) {
          // Shift real-time trigger left to center the pair
          setNodes((prev) => [
            ...prev.map((n) =>
              n.type === "trigger" ? { ...n, x: n.x - (NODE_WIDTH / 2 + 20) } : n
            ),
            { id: newId, type: "searchTrigger" as CanvasNodeType, x: siblingX + NODE_WIDTH + 40 - (NODE_WIDTH / 2 + 20), y: siblingY },
          ])
        } else {
          setNodes((prev) => [
            ...prev,
            { id: newId, type: "searchTrigger" as CanvasNodeType, x: 300, y: 120 },
          ])
        }

        const defaultSearch: SearchTriggerConfig = {
          triggerName: "",
          objectType: resolveObjectType(state),
          searchCriteria: [],
          frequency: "DAILY",
          scheduleTime: "06:00",
          scheduleTimezone: "UTC",
          batchSize: 500,
          searchMaxRecords: null,
          skipRecentlyRouted: false,
          isDryRun: false,
        }
        setState((s) => ({ ...s, routeType: "SCHEDULED", searchTrigger: defaultSearch }))
        setActiveSheet({ type: "searchTrigger", nodeId: newId })
        return
      }

      // ── Match step: insert between trigger and filters ──────────────────────
      if (stepType === "match") {
        const triggerNode = nodes.find((n) => n.type === "trigger")
        const matchY = (triggerNode?.y ?? 120) + 140
        const matchX = triggerNode?.x ?? 300
        // Shift existing filter/assign/defaultOwner nodes down
        setNodes((prev) => [
          ...prev
            .filter((n) => n.type !== "match")
            .map((n) =>
              n.type === "filter" || n.type === "assign" || n.type === "defaultOwner"
                ? { ...n, y: n.y + 140 }
                : n
            ),
          { id: newId, type: "match" as CanvasNodeType, x: matchX, y: matchY },
        ])
        setState((s) => ({ ...s, matchConfig: s.matchConfig ?? defaultMatchConfig() }))
        setActiveSheet({ type: "match", nodeId: newId })
        return
      }

      // ── Filter step: creates a new path column (filter + assign pair) ───────
      if (stepType === "filter") {
        const existingFilterNodes = nodes.filter((n) => n.type === "filter")
        const splitCandidates = nodes.filter((n) => n.type === "trigger" || n.type === "match")
        const splitNode = splitCandidates[splitCandidates.length - 1] ?? nodes[0]
        if (!splitNode) return

        // All filter nodes share the same Y; new one placed to the right
        const filterY =
          existingFilterNodes.length > 0
            ? existingFilterNodes[0].y
            : splitNode.y + 140
        const filterX =
          existingFilterNodes.length > 0
            ? Math.max(...existingFilterNodes.map((n) => n.x)) + FILTER_GAP
            : splitNode.x

        const newPathId = crypto.randomUUID()
        const pathLabel = `Path ${String.fromCharCode(65 + existingFilterNodes.length)}`
        const filterId = `filter-${Date.now()}`
        const assignId = `assign-${Date.now() + 1}`

        const newFilter: CanvasNode = { id: filterId, type: "filter", x: filterX, y: filterY, pathId: newPathId }
        const newAssign: CanvasNode = { id: assignId, type: "assign", x: filterX, y: filterY + 140, pathId: newPathId }

        // Insert filter+assign before any defaultOwner node
        setNodes((prev) => {
          const defaults = prev.filter((n) => n.type === "defaultOwner")
          const rest = prev.filter((n) => n.type !== "defaultOwner")
          return [...rest, newFilter, newAssign, ...defaults]
        })

        setState((s) => ({
          ...s,
          paths: [
            ...s.paths,
            { id: newPathId, label: pathLabel, conditions: [], action: { assignmentType: null, assigneeId: null, assigneeName: null } },
          ],
        }))

        setActiveSheet({ type: "filter", nodeId: filterId, pathId: newPathId })
        return
      }

      // ── Default Owner: below all assigns, horizontally centered ────────────
      if (stepType === "defaultOwner") {
        const assignNodes = nodes.filter((n) => n.type === "assign")
        const filterNodes = nodes.filter((n) => n.type === "filter")
        const splitCandidates = nodes.filter((n) => n.type === "trigger" || n.type === "match")
        const splitNode = splitCandidates[splitCandidates.length - 1] ?? nodes[0]

        const defaultY =
          assignNodes.length > 0
            ? Math.max(...assignNodes.map((n) => n.y)) + 140
            : (splitNode?.y ?? 120) + 140
        const defaultX =
          filterNodes.length > 0
            ? Math.round(filterNodes.reduce((sum, n) => sum + n.x, 0) / filterNodes.length)
            : nodes.find((n) => n.type === "trigger")?.x ?? 300

        // Only one defaultOwner allowed — replace any existing
        setNodes((prev) => [
          ...prev.filter((n) => n.type !== "defaultOwner"),
          { id: newId, type: "defaultOwner" as CanvasNodeType, x: defaultX, y: defaultY },
        ])
        setActiveSheet({ type: "defaultOwner", nodeId: newId })
        return
      }
    },
    [nodes]
  )

  // ── Delete a node ─────────────────────────────────────────────────────────────
  const handleDeleteNode = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return

    if (node.type === "trigger") {
      // Re-center the search trigger if present
      setNodes((prev) =>
        prev
          .filter((n) => n.id !== nodeId)
          .map((n) => n.type === "searchTrigger" ? { ...n, x: 300 } : n)
      )
      setState((s) => ({ ...s, trigger: null }))
      if (activeSheet?.type === "trigger") setActiveSheet(null)
      return
    }

    if (node.type === "searchTrigger") {
      // Re-center the real-time trigger if present
      setNodes((prev) =>
        prev
          .filter((n) => n.id !== nodeId)
          .map((n) => n.type === "trigger" ? { ...n, x: 300 } : n)
      )
      setState((s) => ({ ...s, searchTrigger: null }))
      if (activeSheet?.type === "searchTrigger") setActiveSheet(null)
      return
    }

    if (node.type === "match") {
      // Shift filter/assign/defaultOwner back up
      setNodes((prev) =>
        prev
          .filter((n) => n.id !== nodeId)
          .map((n) =>
            n.type === "filter" || n.type === "assign" || n.type === "defaultOwner"
              ? { ...n, y: n.y - 140 }
              : n
          )
      )
      setState((s) => ({ ...s, matchConfig: null }))
      return
    }

    if (node.type === "filter") {
      const { pathId } = node
      // Remove this filter AND its paired assign
      setNodes((prev) => prev.filter((n) => n.id !== nodeId && n.pathId !== pathId))
      if (pathId) {
        setState((s) => ({ ...s, paths: s.paths.filter((p) => p.id !== pathId) }))
      }
      return
    }

    if (node.type === "assign") {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId))
      if (node.pathId) {
        setState((s) => ({
          ...s,
          paths: s.paths.map((p) =>
            p.id === node.pathId
              ? { ...p, action: { assignmentType: null, assigneeId: null, assigneeName: null } }
              : p
          ),
        }))
      }
      return
    }

    if (node.type === "defaultOwner") {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId))
      setState((s) => ({ ...s, defaultOwner: null }))
      return
    }
  }, [nodes])

  // ── Save ──────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveError(null)
    setInternalIsSaving(true)
    try {
      await onSave(state)
      setSavedState(state)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save route.")
    } finally {
      setInternalIsSaving(false)
    }
  }

  // ── Derived values ────────────────────────────────────────────────────────────
  const activeTypes = nodes.map((n) => n.type)
  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + NODE_WIDTH + 100), 800)
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + NODE_HEIGHT + 100), 600)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  useEffect(() => {
    const onUp = () => setDraggingId(null)
    window.addEventListener("mouseup", onUp)
    return () => window.removeEventListener("mouseup", onUp)
  }, [])

  // ── English view helpers ────────────────────────────────────────────────────
  const englishErrorCount = useMemo(() => {
    const review = routeToEnglish(state)
    return (review?.warnings ?? []).filter((w) => w.severity === "error").length
  }, [state])

  const handleFocusPath = useCallback((pathId?: string) => {
    setActiveTab("canvas")
    if (pathId) {
      const filterNode = nodes.find((n) => n.type === "filter" && n.pathId === pathId)
      if (filterNode) {
        setActiveSheet({ type: "filter", nodeId: filterNode.id, pathId })
      }
    }
  }, [nodes])

  // Active path ids (null when the relevant sheet is not open)
  const activeFilterPathId = activeSheet?.type === "filter" ? activeSheet.pathId : null
  const activeAssignPathId = activeSheet?.type === "assign" ? activeSheet.pathId : null

  return (
    <div
      className="flex flex-col bg-background -m-6"
      style={{ height: "calc(100% + 3rem)", overflow: "hidden" }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 border-b bg-white dark:bg-[#12121a]"
        style={{ height: TOP_BAR_HEIGHT }}
      >
        <input
          type="text"
          value={state.name}
          onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
          className="flex-1 min-w-0 text-sm font-medium bg-transparent border-none outline-none focus:ring-0 placeholder:text-muted-foreground"
          placeholder="Route name…"
          aria-label="Route name"
        />

        {/* Tab toggle */}
        <div className="flex items-center rounded-lg border bg-muted/50 p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab("canvas")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              activeTab === "canvas"
                ? "bg-white dark:bg-[#1a1a24] text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Canvas
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("english")}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === "english"
                ? "bg-white dark:bg-[#1a1a24] text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="size-3" />
            English
            {englishErrorCount > 0 && (
              <span className="flex items-center justify-center size-4 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold">
                {englishErrorCount}
              </span>
            )}
          </button>
        </div>

        {aiEnabled && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowAIGenerator(true)}
            className="gap-1.5 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
          >
            <Sparkles className="size-3.5" />
            AI Generate
          </Button>
        )}

        {isDirty && (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            Unsaved changes
          </span>
        )}
        {saveError && (
          <span className="text-xs text-destructive max-w-[240px] truncate">
            {saveError}
          </span>
        )}
        {state.routeType === "SCHEDULED" && (
          <Button
            type="button"
            size="sm"
            onClick={() => setShowRunPanel(true)}
            disabled={isRunActive}
            className={[
              "gap-1.5",
              isRunActive
                ? "bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800 pointer-events-none"
                : "bg-teal-500 hover:bg-teal-600 dark:bg-teal-600 dark:hover:bg-teal-700 text-white",
            ].join(" ")}
          >
            {isRunActive ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {isRunActive ? "Running…" : "Run Route"}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isSaving || !isDirty}
          className="gap-1.5"
        >
          <Save className="size-3.5" />
          {isSaving ? "Saving…" : "Save Route"}
        </Button>
      </div>

      {/* ── Body (canvas + registry OR english view) ────────────────────────── */}
      <div className="flex flex-1 overflow-hidden relative">
        {activeTab === "english" ? (
          <EnglishView state={state} onEditInCanvas={handleFocusPath} />
        ) : (<>
        {/* Canvas */}
        <div
          ref={canvasRef}
          className="flex-1 overflow-hidden relative"
          style={{
            backgroundImage:
              `radial-gradient(circle, ${isDark ? 'rgba(255,255,255,0.08)' : '#d1d5db'} 1.5px, transparent 1.5px)`,
            backgroundSize: `${24 * scale}px ${24 * scale}px`,
            backgroundPosition: `${panX}px ${panY}px`,
            cursor: isPanning ? "grabbing" : "grab",
          }}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onWheel={handleWheel}
          onMouseDown={handleCanvasPanStart}
        >
          <div
            className="relative"
            style={{
              transformOrigin: "0 0",
              transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
              minWidth: maxX,
              minHeight: maxY,
              width: "100%",
              height: "100%",
            }}
          >
            {/* SVG overlay for edges */}
            <svg
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: maxX,
                height: maxY,
                pointerEvents: "none",
                zIndex: 1,
              }}
            >
              {edges.map((edge) => {
                const fromNode = nodes.find((n) => n.id === edge.fromId)
                const toNode = nodes.find((n) => n.id === edge.toId)
                if (!fromNode || !toNode) return null
                return (
                  <Edge
                    key={`${edge.fromId}-${edge.toId}`}
                    fromNode={fromNode}
                    toNode={toNode}
                  />
                )
              })}
            </svg>

            {/* Nodes */}
            {nodes.map((node) => {
              const pathLabel =
                node.type === "filter"
                  ? (state.paths.find((p) => p.id === node.pathId)?.label ?? "Filter")
                  : undefined

              return (
                <CanvasNodeCard
                  key={node.id}
                  node={node}
                  title={pathLabel}
                  subtitle={nodeSubtitle(node, state)}
                  isDragging={draggingId === node.id}
                  glowState={glowForNode(node.type)}
                  onMouseDown={(e, id) => {
                    setDraggingId(id)
                    handleNodeMouseDown(e, id)
                  }}
                  onClick={handleNodeClick}
                  onDelete={handleDeleteNode}
                  onTitleChange={
                    node.type === "filter" && node.pathId
                      ? (newLabel) =>
                          setState((s) => ({
                            ...s,
                            paths: s.paths.map((p) =>
                              p.id === node.pathId ? { ...p, label: newLabel } : p
                            ),
                          }))
                      : undefined
                  }
                />
              )
            })}
          </div>

          {/* ── Zoom controls ──────────────────────────────────────────────── */}
          <div className="absolute bottom-4 left-4 flex items-center gap-1 rounded-lg border bg-white/90 dark:bg-[rgba(18,18,26,0.9)] backdrop-blur-sm shadow-sm p-1 z-50">
            <button
              type="button"
              onClick={zoomOut}
              className="flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Zoom out"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="text-[11px] font-medium text-muted-foreground min-w-[3rem] text-center tabular-nums">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={zoomIn}
              className="flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Zoom in"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              type="button"
              onClick={fitToView}
              className="flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Fit to view"
            >
              <Maximize2 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={resetZoom}
              className="flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Reset zoom (100%)"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Step registry panel */}
        <StepRegistry activeTypes={activeTypes} />
        </>)}

        {/* ── Run panel (slides in from right over canvas) ───────────────────── */}
        {state.routeType === "SCHEDULED" && (
          <RunPanel
            ruleId={_ruleId ?? ""}
            routeName={state.name}
            isOpen={showRunPanel}
            onClose={() => setShowRunPanel(false)}
            onRunningStepChange={handleRunningStepChange}
            onRunStateChange={handleRunStateChange}
            routeSteps={{
              hasMatch: state.matchConfig !== null,
              hasPaths: state.paths.length > 0,
              hasDefaultOwner: state.defaultOwner !== null,
            }}
          />
        )}
      </div>

      {/* ── Config sheets ────────────────────────────────────────────────────── */}

      {state.trigger && (
        <TriggerConfigSheet
          open={activeSheet?.type === "trigger"}
          onOpenChange={(open) => !open && closeSheet()}
          trigger={state.trigger}
          onSave={(trigger) => setState((s) => ({ ...s, trigger }))}
        />
      )}

      {state.searchTrigger && (
        <SearchTriggerConfigSheet
          open={activeSheet?.type === "searchTrigger"}
          onOpenChange={(open) => !open && closeSheet()}
          searchTrigger={state.searchTrigger}
          onSave={(searchTrigger) => setState((s) => ({ ...s, searchTrigger }))}
        />
      )}

      <MatchConfigSheet
        open={activeSheet?.type === "match"}
        onOpenChange={(open) => !open && closeSheet()}
        matchConfig={state.matchConfig ?? defaultMatchConfig()}
        onSave={(matchConfig: MatchConfig) => setState((s) => ({ ...s, matchConfig }))}
      />

      {/* Filter sheet — one instance driven by activeFilterPathId */}
      <FilterConfigSheet
        key={activeFilterPathId ?? "filter-closed"}
        open={activeSheet?.type === "filter"}
        onOpenChange={(open) => !open && closeSheet()}
        pathLabel={
          activeFilterPathId
            ? (state.paths.find((p) => p.id === activeFilterPathId)?.label ?? "Path")
            : "Path"
        }
        conditions={
          activeFilterPathId
            ? (state.paths.find((p) => p.id === activeFilterPathId)?.conditions ?? [])
            : []
        }
        objectType={resolveObjectType(state)}
        onSave={(conditions: RuleConditions) => {
          if (!activeFilterPathId) return
          const pathId = activeFilterPathId
          setState((s) => ({
            ...s,
            paths: s.paths.map((p) => (p.id === pathId ? { ...p, conditions } : p)),
          }))
        }}
        onLabelChange={(label: string) => {
          if (!activeFilterPathId) return
          const pathId = activeFilterPathId
          setState((s) => ({
            ...s,
            paths: s.paths.map((p) => (p.id === pathId ? { ...p, label } : p)),
          }))
        }}
      />

      {/* Assign sheet — one instance driven by activeAssignPathId */}
      <ActionConfigSheet
        key={activeAssignPathId ?? "assign-closed"}
        open={activeSheet?.type === "assign"}
        onOpenChange={(open) => !open && closeSheet()}
        pathLabel={
          activeAssignPathId
            ? (state.paths.find((p) => p.id === activeAssignPathId)?.label ?? "Path")
            : "Path"
        }
        action={
          activeAssignPathId
            ? (state.paths.find((p) => p.id === activeAssignPathId)?.action ?? {
                assignmentType: null,
                assigneeId: null,
                assigneeName: null,
              })
            : { assignmentType: null, assigneeId: null, assigneeName: null }
        }
        onSave={(action: PathAction) => {
          if (!activeAssignPathId) return
          const pathId = activeAssignPathId
          setState((s) => ({
            ...s,
            paths: s.paths.map((p) => (p.id === pathId ? { ...p, action } : p)),
          }))
        }}
      />

      <DefaultOwnerConfigSheet
        open={activeSheet?.type === "defaultOwner"}
        onOpenChange={(open) => !open && closeSheet()}
        defaultOwner={state.defaultOwner}
        onSave={(defaultOwner: DefaultOwner) =>
          setState((s) => ({ ...s, defaultOwner }))
        }
        onClear={() => setState((s) => ({ ...s, defaultOwner: null }))}
      />

      {/* ── AI Route Generator floating panel ──────────────────────────────── */}
      {showAIGenerator && (
        <AIRouteGenerator
          onApply={handleApplyAIRoute}
          onClose={() => setShowAIGenerator(false)}
        />
      )}

    </div>
  )
}
