"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { useTheme } from "next-themes"
import { Zap, Search, Filter, UserCheck, AlertTriangle, X, Save, ZoomIn, ZoomOut, Maximize2, RotateCcw, FileText, Play, Loader2, Sparkles, GitBranch, Pencil, ClipboardList } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StepRegistry, type CanvasNodeType } from "./StepRegistry"
import { TriggerConfigSheet } from "./config/TriggerConfigSheet"
import { SearchTriggerConfigSheet } from "./config/SearchTriggerConfigSheet"
import { MatchConfigSheet, defaultMatchConfig } from "./config/MatchConfigSheet"
import { FilterConfigSheet } from "./config/FilterConfigSheet"
import { ActionConfigSheet } from "./config/ActionConfigSheet"
import { UpdateFieldConfigSheet } from "./config/UpdateFieldConfigSheet"
import { CreateTaskConfigSheet } from "./config/CreateTaskConfigSheet"
import { DefaultOwnerConfigSheet } from "./config/DefaultOwnerConfigSheet"
import type {
  RouteBuilderState,
  MatchConfig,
  DefaultOwner,
  PathAction,
  SearchTriggerConfig,
  PathStep,
  PathStepType,
  PathStepSplit,
  RoutePath,
} from "./types"
import { defaultBuilderState, defaultTriggerConfig, triggerEventLabel, resolveObjectType, migrateStateToV2, findPathById, updatePathById, updateSplitStep, flattenAllPaths, flattenAllSplits, getPathDepth, MAX_SPLIT_DEPTH } from "./types"
import type { RuleConditions } from "@/components/condition-builder"
import type { ConditionGroup } from "@/components/condition-builder/types"
import { EnglishView } from "./EnglishView"
import { routeToEnglish } from "@/lib/route-to-english"
import { RunPanel, type RunningStep } from "./RunPanel"
import { AIRouteGenerator } from "./AIRouteGenerator"

// ─── Constants ────────────────────────────────────────────────────────────────

const NODE_WIDTH = 220
const NODE_HEIGHT = 72
const TOP_BAR_HEIGHT = 56
const FILTER_GAP = NODE_WIDTH + 40   // horizontal gap between parallel path columns
const STEP_GAP_Y = 100               // vertical gap between steps within a branch
const SPLIT_W = 200                  // width of the split pill node

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
  pathId?: string            // links step nodes to a RoutePath
  stepIndex?: number         // index within a path's steps[] array
  depth?: number             // nesting level (0 = top-level)
  splitParentPathId?: string // for split/defaultOwner nodes: parent path ID
  splitStepIndex?: number    // for split/defaultOwner nodes: index in parent path's steps[]
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
  | { type: "updateField"; nodeId: string; pathId: string; stepIndex: number }
  | { type: "createTask"; nodeId: string; pathId: string; stepIndex: number }
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
  split: {
    icon: GitBranch,
    label: "Split",
    borderClass: "border-l-4 border-l-slate-400",
    iconBg: "bg-slate-100 dark:bg-slate-800",
    iconColor: "text-slate-500 dark:text-slate-400",
  },
  updateField: {
    icon: Pencil,
    label: "Update Field",
    borderClass: "border-l-4 border-l-yellow-500",
    iconBg: "bg-yellow-100 dark:bg-yellow-900",
    iconColor: "text-yellow-600 dark:text-yellow-400",
  },
  createTask: {
    icon: ClipboardList,
    label: "Create Task",
    borderClass: "border-l-4 border-l-sky-500",
    iconBg: "bg-sky-100 dark:bg-sky-900",
    iconColor: "text-sky-600 dark:text-sky-400",
  },
}

// ─── Derive edges from nodes ───────────────────────────────────────────────────
//
// Generates edges by walking the state tree and mapping to node IDs.
// Simple approach: for each path, chain steps linearly; for splits, recurse.
//

function computeEdgesFromState(
  paths: RoutePath[],
  parentId: string | null,  // node ID above this group (split pill, match, trigger)
  exitId: string | null,    // node ID below this group (default owner, etc.)
  nodeExists: (id: string) => boolean,
): CanvasEdge[] {
  const edges: CanvasEdge[] = []

  for (const path of paths) {
    const steps = path.steps ?? []
    let prevId = parentId

    for (let si = 0; si < steps.length; si++) {
      const step = steps[si]

      if (step.type === "split") {
        const pillId = `split_${path.id}_${si}`
        const doId = `do_${path.id}_${si}`
        const hasPill = step.paths.length > 1 && nodeExists(pillId)
        const hasDO = nodeExists(doId)

        // prev → split pill
        if (hasPill && prevId) {
          edges.push({ fromId: prevId, toId: pillId })
        }

        // Determine what sub-paths converge to after this split
        const nextInParent = si + 1 < steps.length ? `s_${path.id}_${si + 1}` : null
        const subExit = hasDO ? doId : (nextInParent && nodeExists(nextInParent) ? nextInParent : exitId)

        // Recurse into sub-paths
        const subParent = hasPill ? pillId : prevId
        edges.push(...computeEdgesFromState(step.paths, subParent, subExit, nodeExists))

        // DO → next step in parent
        if (hasDO && nextInParent && nodeExists(nextInParent)) {
          edges.push({ fromId: doId, toId: nextInParent })
          prevId = nextInParent
        } else if (hasDO) {
          prevId = doId
        } else {
          prevId = null
        }
      } else {
        const nid = `s_${path.id}_${si}`
        if (!nodeExists(nid)) continue
        if (prevId) edges.push({ fromId: prevId, toId: nid })
        prevId = nid
      }
    }

    // Last step → exit
    if (prevId && exitId && prevId !== exitId) {
      edges.push({ fromId: prevId, toId: exitId })
    }
  }

  return edges
}

function computeEdges(nodes: CanvasNode[], state: RouteBuilderState): CanvasEdge[] {
  const edges: CanvasEdge[] = []
  const nodeSet = new Set(nodes.map(n => n.id))
  const nodeExists = (id: string) => nodeSet.has(id)

  const trigger = nodes.find(n => n.type === "trigger")
  const searchTrigger = nodes.find(n => n.type === "searchTrigger")
  const match = nodes.find(n => n.type === "match")
  const defaultOwner = nodes.find(n => n.id === "defaultOwner")
  const topSplit = nodes.find(n => n.id === "split")
  const paths = state.paths

  // Trigger → first downstream
  const first = match ?? topSplit ?? (paths.length === 1 ? nodes.find(n => n.pathId === paths[0]?.id && n.stepIndex === 0) : undefined) ?? defaultOwner
  if (trigger && first) edges.push({ fromId: trigger.id, toId: first.id })
  if (searchTrigger && first) edges.push({ fromId: searchTrigger.id, toId: first.id })

  // Match → split or first step
  if (match && topSplit) {
    edges.push({ fromId: match.id, toId: topSplit.id })
  } else if (match && !topSplit && paths.length === 1) {
    const fs = nodes.find(n => n.pathId === paths[0].id && n.stepIndex === 0)
    if (fs) edges.push({ fromId: match.id, toId: fs.id })
  } else if (match && !topSplit && paths.length === 0 && defaultOwner) {
    edges.push({ fromId: match.id, toId: defaultOwner.id })
  }

  // Path edges — recursive
  if (paths.length > 0) {
    const parentId = topSplit?.id ?? match?.id ?? trigger?.id ?? searchTrigger?.id ?? null
    edges.push(...computeEdgesFromState(paths, parentId, defaultOwner?.id ?? null, nodeExists))
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
      const path = node.pathId ? findPathById(state.paths, node.pathId) : null
      if (!path) return "No path"
      // V2: read from steps[] if stepIndex is present
      if (node.stepIndex !== undefined && path.steps?.[node.stepIndex]?.type === "filter") {
        const step = path.steps[node.stepIndex] as { type: "filter"; conditions: any[] }
        const allConds = Array.isArray(step.conditions) ? step.conditions.flatMap((g: any) => Array.isArray(g?.conditions) ? g.conditions : []) : []
        const count = allConds.length
        if (count === 0) return "No conditions (catch-all)"
        const first = allConds[0]
        const preview = `${first.fieldApiName} ${first.operator}${first.value ? ` ${first.value}` : ""}`
        return count === 1 ? preview : `${preview} +${count - 1} more`
      }
      // Legacy: read from path.conditions
      const allConds = Array.isArray(path.conditions) ? path.conditions.flatMap((g: any) => Array.isArray(g?.conditions) ? g.conditions : []) : []
      const count = allConds.length
      if (count === 0) return "No conditions (catch-all)"
      const first = allConds[0]
      const preview = `${first.fieldApiName} ${first.operator}${first.value ? ` ${first.value}` : ""}`
      return count === 1 ? preview : `${preview} +${count - 1} more`
    }
    case "assign": {
      const path = node.pathId ? findPathById(state.paths, node.pathId) : null
      if (!path) return "No path"
      // V2: read from steps[] if stepIndex is present
      if (node.stepIndex !== undefined && path.steps?.[node.stepIndex]?.type === "assign") {
        const step = path.steps[node.stepIndex] as { type: "assign"; assignmentType: string | null; assigneeName: string | null }
        if (!step.assignmentType) return "Not configured"
        const type = step.assignmentType === "USER" ? "User" : step.assignmentType === "ROUND_ROBIN" ? "Round Robin" : "Queue"
        return step.assigneeName ? `${type}: ${step.assigneeName}` : type
      }
      // Legacy: read from path.action
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
      // Nested default owner — look up from split step
      if (node.splitParentPathId && node.splitStepIndex !== undefined) {
        const parentPath = findPathById(state.paths, node.splitParentPathId)
        const splitStep = parentPath?.steps?.[node.splitStepIndex]
        if (splitStep?.type === "split" && splitStep.defaultOwner) {
          const do_ = splitStep.defaultOwner
          const type = do_.assignmentType === "USER" ? "User" : do_.assignmentType === "ROUND_ROBIN" ? "Round Robin" : "Queue"
          return do_.assigneeName ? `${type}: ${do_.assigneeName}` : type
        }
        return "Not configured"
      }
      // Top-level default owner
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
    case "split": {
      // For nested splits, look up the split step to get its path count
      if (node.splitParentPathId && node.splitStepIndex !== undefined) {
        const parentPath = findPathById(state.paths, node.splitParentPathId)
        const splitStep = parentPath?.steps?.[node.splitStepIndex]
        if (splitStep?.type === "split") {
          return `${splitStep.paths.length} path${splitStep.paths.length !== 1 ? "s" : ""}`
        }
      }
      // Top-level split
      const pathCount = state.paths.length
      return `${pathCount} path${pathCount !== 1 ? "s" : ""}`
    }
    case "updateField": {
      if (node.pathId && node.stepIndex !== undefined) {
        const path = node.pathId ? findPathById(state.paths, node.pathId) : null
        const step = path?.steps?.[node.stepIndex]
        if (step?.type === "updateField" && step.fieldApiName) {
          return `${step.fieldApiName} = ${step.fieldValue || "…"}`
        }
      }
      return "Not configured"
    }
    case "createTask": {
      if (node.pathId && node.stepIndex !== undefined) {
        const path = node.pathId ? findPathById(state.paths, node.pathId) : null
        const step = path?.steps?.[node.stepIndex]
        if (step?.type === "createTask" && step.subject) {
          return step.subject
        }
      }
      return "Not configured"
    }
  }
}

// ─── SVG Edge component ───────────────────────────────────────────────────────

interface EdgeProps {
  fromNode: CanvasNode
  toNode: CanvasNode
}

const SPLIT_H = 32  // height of the split pill node

function Edge({ fromNode, toNode }: EdgeProps) {
  const fromW = fromNode.type === "split" ? SPLIT_W : NODE_WIDTH
  const fromH = fromNode.type === "split" ? SPLIT_H : NODE_HEIGHT
  const toW = toNode.type === "split" ? SPLIT_W : NODE_WIDTH

  const sx = fromNode.x + fromW / 2
  const sy = fromNode.y + fromH
  const tx = toNode.x + toW / 2
  const ty = toNode.y

  // Right-angle elbows instead of Bezier curves
  let d: string
  if (sx === tx) {
    // Straight vertical line
    d = `M ${sx} ${sy} L ${tx} ${ty}`
  } else {
    // Right-angle elbow: down to midpoint, horizontal, then down
    const midY = (sy + ty) / 2
    d = `M ${sx} ${sy} L ${sx} ${midY} L ${tx} ${midY} L ${tx} ${ty}`
  }

  return (
    <path
      d={d}
      stroke="#94a3b8"
      strokeWidth={2}
      fill="none"
      strokeLinecap="round"
      strokeDasharray="6 4"
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
// V3: supports recursive nested splits via PathStepSplit.
//

const SPLIT_GAP = 50  // horizontal gap between branches within a split
const SPLIT_PILL_H = 56 // vertical space consumed by a split pill (pill is 32px + gap)

/** Calculate the horizontal width a single path column needs, accounting for nested splits */
function measurePathWidth(path: RoutePath): number {
  for (const step of (path.steps ?? [])) {
    if (step.type === "split" && step.paths.length > 0) {
      const subWidths = step.paths.map(sp => measurePathWidth(sp))
      return Math.max(NODE_WIDTH, subWidths.reduce((sum, w) => sum + w, 0) + (step.paths.length - 1) * SPLIT_GAP)
    }
  }
  return NODE_WIDTH
}

interface LayoutResult {
  nodes: CanvasNode[]
  maxBottomY: number
}

/** Recursively layout a set of paths starting at (centerX, startY) */
function layoutPaths(
  paths: RoutePath[],
  centerX: number,
  startY: number,
  depth: number,
  parentPathId?: string,
  parentStepIndex?: number,
): LayoutResult {
  const nodes: CanvasNode[] = []
  let y = startY

  // Insert split pill if multiple paths
  if (paths.length > 1) {
    nodes.push({
      id: parentPathId ? `split_${parentPathId}_${parentStepIndex}` : "split",
      type: "split",
      x: centerX - SPLIT_W / 2,
      y,
      depth,
      splitParentPathId: parentPathId,
      splitStepIndex: parentStepIndex,
    })
    y += SPLIT_PILL_H
  }

  // Measure widths for horizontal positioning
  const pathWidths = paths.map(p => measurePathWidth(p))
  const totalW = pathWidths.reduce((s, w) => s + w, 0) + (paths.length - 1) * SPLIT_GAP
  let xCursor = centerX - totalW / 2
  let maxBot = y

  paths.forEach((path, pi) => {
    const pathCenterX = xCursor + pathWidths[pi] / 2
    let sy = y

    const steps = path.steps ?? []
    for (let si = 0; si < steps.length; si++) {
      const step = steps[si]

      if (step.type === "split") {
        // Add extra gap before split to leave room for the "+ Add Step" button above
        if (si > 0) sy += 48
        // Recursively layout nested split
        const subResult = layoutPaths(step.paths, pathCenterX, sy, depth + 1, path.id, si)
        nodes.push(...subResult.nodes)
        sy = subResult.maxBottomY

        // Nested default owner
        if (step.defaultOwner) {
          nodes.push({
            id: `do_${path.id}_${si}`,
            type: "defaultOwner",
            x: pathCenterX - NODE_WIDTH / 2,
            y: sy,
            depth: depth + 1,
            splitParentPathId: path.id,
            splitStepIndex: si,
          })
          sy += STEP_GAP_Y
        }
        // Extra gap after nested split before next step
        sy += 20
      } else {
        // Regular step node
        nodes.push({
          id: `s_${path.id}_${si}`,
          type: step.type as CanvasNodeType,
          x: pathCenterX - NODE_WIDTH / 2,
          y: sy,
          pathId: path.id,
          stepIndex: si,
          depth,
        })
        sy += STEP_GAP_Y
      }
    }

    maxBot = Math.max(maxBot, sy)
    xCursor += pathWidths[pi] + SPLIT_GAP
  })

  return { nodes, maxBottomY: maxBot }
}

function buildNodesFromState(initialState?: Partial<RouteBuilderState>): CanvasNode[] {
  const migrated = initialState ? migrateStateToV2(initialState as RouteBuilderState) : null
  const hasTrigger = !!migrated?.trigger
  const hasSearchTrigger = !!migrated?.searchTrigger
  const bothTriggers = hasTrigger && hasSearchTrigger
  const nodes: CanvasNode[] = []
  const GAP_Y = 110

  const centerX = 400

  if (hasTrigger) {
    nodes.push({ id: "trigger", type: "trigger", x: bothTriggers ? centerX - NODE_WIDTH - 20 : centerX - NODE_WIDTH / 2, y: 120 })
  }
  if (hasSearchTrigger) {
    nodes.push({ id: "searchTrigger", type: "searchTrigger", x: bothTriggers ? centerX + 20 : centerX - NODE_WIDTH / 2, y: 120 })
  }

  const matchConfig = migrated?.matchConfig
  const paths = migrated?.paths ?? []
  const defaultOwner = migrated?.defaultOwner

  let y = 120
  if (hasTrigger || hasSearchTrigger) y += GAP_Y

  if (matchConfig) {
    nodes.push({ id: "match", type: "match", x: centerX - NODE_WIDTH / 2, y })
    y += GAP_Y
  }

  if (paths.length > 0) {
    const result = layoutPaths(paths, centerX, y, 0)
    nodes.push(...result.nodes)
    y = result.maxBottomY + 40

    if (defaultOwner) {
      nodes.push({ id: "defaultOwner", type: "defaultOwner", x: centerX - NODE_WIDTH / 2, y })
    }
  } else if (defaultOwner) {
    nodes.push({ id: "defaultOwner", type: "defaultOwner", x: centerX - NODE_WIDTH / 2, y })
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
  const [state, setState] = useState<RouteBuilderState>(() => {
    const merged: RouteBuilderState = {
      ...base,
      ...initialState,
      trigger: initialState?.trigger
        ? { ...defaultTriggerConfig(), ...initialState.trigger }
        : null,
      paths: initialState?.paths ?? base.paths,
    }
    // Migrate all paths to V2 (ensure steps[] is populated)
    return migrateStateToV2(merged)
  })

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
  const edges = useMemo(() => computeEdges(nodes, state), [nodes, state])

  // ── Sheet state ─────────────────────────────────────────────────────────────
  const [activeSheet, setActiveSheet] = useState<ActiveSheet>(null)
  const closeSheet = useCallback(() => setActiveSheet(null), [])

  // ── "Add Step" dropdown state ──────────────────────────────────────────────
  const [addStepDropdown, setAddStepDropdown] = useState<{
    pathId: string
    x: number
    y: number
  } | null>(null)

  // Track the last path the user interacted with (for registry click targeting)
  const lastActivePathIdRef = useRef<string | null>(null)

  // ── Step management helpers ────────────────────────────────────────────────

  function createDefaultStep(type: PathStepType): PathStep {
    switch (type) {
      case "filter":
        return { type: "filter", conditions: [] }
      case "updateField":
        return { type: "updateField", fieldApiName: "", fieldValue: "" }
      case "createTask":
        return {
          type: "createTask",
          subject: "",
          priority: "Normal",
          status: "Not Started",
          dueDateOffset: null,
          description: "",
        }
      case "assign":
        return {
          type: "assign",
          assignmentType: null,
          assigneeId: null,
          assigneeName: null,
        }
      case "split":
        return {
          type: "split",
          paths: [
            {
              id: crypto.randomUUID(),
              label: "Sub-Path 1",
              conditions: [],
              action: { assignmentType: null, assigneeId: null, assigneeName: null },
              steps: [{ type: "filter" as const, conditions: [] }],
            },
            {
              id: crypto.randomUUID(),
              label: "Sub-Path 2",
              conditions: [],
              action: { assignmentType: null, assigneeId: null, assigneeName: null },
              steps: [{ type: "filter" as const, conditions: [] }],
            },
          ],
          defaultOwner: null,
        }
    }
  }

  function handleAddStepToPath(pathId: string, stepType: PathStepType) {
    setState((prev) => {
      const newState = {
        ...prev,
        paths: updatePathById(prev.paths, pathId, (p) => {
          const steps = [...(p.steps ?? [])]
          const newStep = createDefaultStep(stepType)
          // Insert before the last assign step (unless adding an assign or split)
          const lastAssignIdx = steps.findLastIndex((s) => s.type === "assign")
          if (lastAssignIdx >= 0 && stepType !== "assign" && stepType !== "split") {
            steps.splice(lastAssignIdx, 0, newStep)
          } else {
            steps.push(newStep)
          }
          return { ...p, steps }
        }),
      }
      setNodes(buildNodesFromState(newState))
      return newState
    })
    setAddStepDropdown(null)
  }

  // ── Drag state (node repositioning inside canvas) ───────────────────────────
  const dragRef = useRef<{
    nodeId: string
    startMouseX: number
    startMouseY: number
    startNodeX: number
    startNodeY: number
    hasMoved: boolean
    // Descendants: nodes below the dragged node that move together
    descendants: { id: string; startX: number; startY: number }[]
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

    // Find all descendant nodes (reachable via edges going downward)
    const descendants: { id: string; startX: number; startY: number }[] = []
    const edgeMap = new Map<string, string[]>()
    for (const edge of edges) {
      if (!edgeMap.has(edge.fromId)) edgeMap.set(edge.fromId, [])
      edgeMap.get(edge.fromId)!.push(edge.toId)
    }
    const visited = new Set<string>()
    const queue = edgeMap.get(nodeId) ?? []
    while (queue.length > 0) {
      const id = queue.shift()!
      if (visited.has(id)) continue
      visited.add(id)
      const n = nodes.find(cn => cn.id === id)
      if (n && n.y > node.y) {
        descendants.push({ id: n.id, startX: n.x, startY: n.y })
        for (const child of (edgeMap.get(id) ?? [])) {
          queue.push(child)
        }
      }
    }

    dragRef.current = {
      nodeId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
      hasMoved: false,
      descendants,
    }
  }, [nodes, edges])

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
      const descIds = new Set(dragRef.current.descendants.map(d => d.id))
      const descMap = new Map(dragRef.current.descendants.map(d => [d.id, d]))
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id === dragRef.current!.nodeId) return { ...n, x: newX, y: newY }
          const desc = descMap.get(n.id)
          if (desc) return { ...n, x: desc.startX + dx, y: desc.startY + dy }
          return n
        })
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
    // Track last active path for registry click targeting
    if (node.pathId) lastActivePathIdRef.current = node.pathId
    if ((node.type === "filter" || node.type === "assign") && node.pathId) {
      setActiveSheet({ type: node.type, nodeId: node.id, pathId: node.pathId })
    } else if (node.type === "updateField" && node.pathId && node.stepIndex !== undefined) {
      setActiveSheet({ type: "updateField", nodeId: node.id, pathId: node.pathId, stepIndex: node.stepIndex })
    } else if (node.type === "createTask" && node.pathId && node.stepIndex !== undefined) {
      setActiveSheet({ type: "createTask", nodeId: node.id, pathId: node.pathId, stepIndex: node.stepIndex })
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

  // Shared logic for adding a step to the canvas (used by both drag-drop and click)
  const addStepToCanvas = useCallback(
    (stepType: CanvasNodeType) => {
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

      // ── Filter step: creates a new path with just a filter ───────
      if (stepType === "filter") {
        const newPathId = crypto.randomUUID()

        setState((s) => {
          const newState = {
            ...s,
            paths: [
              ...s.paths,
              {
                id: newPathId,
                label: `Path ${s.paths.length + 1}`,
                conditions: [],
                action: { assignmentType: null, assigneeId: null, assigneeName: null },
                steps: [
                  { type: 'filter' as const, conditions: [] as ConditionGroup[] },
                ],
              },
            ],
          }
          setNodes(buildNodesFromState(newState))
          return newState
        })

        setTimeout(() => {
          setActiveSheet({ type: "filter", nodeId: `s_${newPathId}_0`, pathId: newPathId })
        }, 0)
        return
      }

      // ── Assign step: add to the first path that doesn't end with an assign ───
      if (stepType === "assign") {
        if (state.paths.length === 0) {
          // No paths yet — create one with just an assign
          const newPathId = crypto.randomUUID()
          setState((s) => {
            const newState = {
              ...s,
              paths: [{
                id: newPathId,
                label: "Path 1",
                conditions: [],
                action: { assignmentType: null, assigneeId: null, assigneeName: null },
                steps: [
                  { type: 'assign' as const, assignmentType: null, assigneeId: null, assigneeName: null },
                ],
              }],
            }
            setNodes(buildNodesFromState(newState))
            return newState
          })
        } else {
          // Add assign to the first path
          const targetId = lastActivePathIdRef.current ?? state.paths[0].id
          handleAddStepToPath(targetId, "assign")
        }
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

      // ── Split: add to the first path ──
      if (stepType === "split") {
        if (state.paths.length === 0) {
          const newPathId = crypto.randomUUID()
          setState((s) => {
            const newState = {
              ...s,
              paths: [{
                id: newPathId,
                label: "Path 1",
                conditions: [],
                action: { assignmentType: null, assigneeId: null, assigneeName: null },
                steps: [
                  { type: 'filter' as const, conditions: [] as ConditionGroup[] },
                  createDefaultStep("split"),
                ],
              }],
            }
            setNodes(buildNodesFromState(newState))
            return newState
          })
        } else {
          const targetId = lastActivePathIdRef.current ?? state.paths[0].id
          handleAddStepToPath(targetId, "split")
        }
        return
      }

      // ── Update Field / Create Task: add as a step to the first path (or create one) ──
      if (stepType === "updateField" || stepType === "createTask") {
        if (state.paths.length === 0) {
          // No paths yet — create one with this step + assign
          const newPathId = crypto.randomUUID()
          setState((s) => {
            const newState = {
              ...s,
              paths: [{
                id: newPathId,
                label: "Path A",
                conditions: [],
                action: { assignmentType: null, assigneeId: null, assigneeName: null },
                steps: [
                  { type: 'filter' as const, conditions: [] as ConditionGroup[] },
                  createDefaultStep(stepType),
                  { type: 'assign' as const, assignmentType: null, assigneeId: null, assigneeName: null },
                ],
              }],
            }
            setNodes(buildNodesFromState(newState))
            return newState
          })
        } else {
          // Add to the first path
          const targetId = lastActivePathIdRef.current ?? state.paths[0].id
          handleAddStepToPath(targetId, stepType as PathStepType)
        }
        return
      }
    },
    [nodes, state.paths]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const stepType = e.dataTransfer.getData("stepType") as CanvasNodeType | ""
      if (!stepType) return
      addStepToCanvas(stepType)
    },
    [addStepToCanvas]
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

    // V2 step nodes (with stepIndex): remove step from path.steps[] and rebuild canvas
    if (node.stepIndex !== undefined && node.pathId) {
      const pathId = node.pathId
      const stepIdx = node.stepIndex
      setState((s) => {
        let newPaths = updatePathById(s.paths, pathId, (p) => {
          if (!p.steps) return p
          const newSteps = p.steps.filter((_, i) => i !== stepIdx)
          return { ...p, steps: newSteps }
        })
        // Remove empty paths at top level
        newPaths = newPaths.filter((p) => (p.steps?.length ?? 0) > 0)
        const newState = { ...s, paths: newPaths }
        setNodes(buildNodesFromState(newState))
        return newState
      })
      return
    }

    // Nested split node: remove the split step from parent path
    if (node.type === "split" && node.splitParentPathId && node.splitStepIndex !== undefined) {
      setState((s) => {
        const newPaths = updatePathById(s.paths, node.splitParentPathId!, (p) => ({
          ...p,
          steps: (p.steps ?? []).filter((_, i) => i !== node.splitStepIndex),
        }))
        const newState = { ...s, paths: newPaths }
        setNodes(buildNodesFromState(newState))
        return newState
      })
      return
    }

    if (node.type === "filter") {
      const { pathId } = node
      // Remove this filter AND its paired assign (legacy layout)
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
          paths: updatePathById(s.paths, node.pathId!, (p) => ({
            ...p, action: { assignmentType: null, assigneeId: null, assigneeName: null }
          })),
        }))
      }
      return
    }

    // Split node is auto-inserted; ignore delete
    if (node.type === "split") return

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
          onMouseDown={(e) => {
            // Don't close Add Step dropdown if clicking inside it
            const target = e.target as HTMLElement
            if (!target.closest("[data-add-step-dropdown]")) {
              setAddStepDropdown(null)
            }
            handleCanvasPanStart(e)
          }}
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
                overflow: "visible",
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
              // Split node renders as a small pill, not a full card
              if (node.type === "split") {
                // Determine the correct path count for this split
                let splitPathCount = state.paths.length // top-level default
                if (node.splitParentPathId && node.splitStepIndex !== undefined) {
                  const parentPath = findPathById(state.paths, node.splitParentPathId)
                  const splitStep = parentPath?.steps?.[node.splitStepIndex]
                  if (splitStep?.type === "split") {
                    splitPathCount = splitStep.paths.length
                  }
                }
                return (
                  <div
                    key={node.id}
                    data-canvas-node
                    style={{
                      position: "absolute",
                      left: node.x,
                      top: node.y,
                      width: SPLIT_W,
                      zIndex: 10,
                    }}
                    className="flex items-center justify-center gap-1.5 h-8 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400"
                  >
                    <GitBranch className="size-3" />
                    <span className="text-[10px] font-semibold uppercase tracking-wider">
                      {splitPathCount} path{splitPathCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                )
              }

              return (
                <CanvasNodeCard
                  key={node.id}
                  node={node}
                  subtitle={nodeSubtitle(node, state)}
                  isDragging={draggingId === node.id}
                  glowState={glowForNode(node.type)}
                  onMouseDown={(e, id) => {
                    setDraggingId(id)
                    handleNodeMouseDown(e, id)
                  }}
                  onClick={handleNodeClick}
                  onDelete={handleDeleteNode}
                />
              )
            })}

            {/* "Add Step" buttons — rendered for every path in the tree */}
            {flattenAllPaths(state.paths).map(({ path }) => {
              const branchNodes = nodes
                .filter((n) => n.pathId === path.id && n.stepIndex !== undefined)
                .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))
              const lastNode = branchNodes[branchNodes.length - 1]
              if (!lastNode) return null
              return (
                <button
                  key={`add-step-${path.id}`}
                  type="button"
                  data-canvas-node
                  style={{
                    position: "absolute",
                    left: lastNode.x,
                    top: lastNode.y + NODE_HEIGHT + 16,
                    width: NODE_WIDTH,
                    zIndex: 15,
                  }}
                  className="flex items-center justify-center gap-1.5 h-10 rounded-xl border-2 border-dashed border-muted-foreground/20 text-muted-foreground/50 text-[11px] font-semibold hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    lastActivePathIdRef.current = path.id
                    setAddStepDropdown({
                      pathId: path.id,
                      x: lastNode.x,
                      y: lastNode.y + NODE_HEIGHT + 64,
                    })
                  }}
                >
                  <span>+</span> Add Step
                </button>
              )
            })}

            {/* "Add Path" buttons — one per split (top-level + nested) */}
            {(() => {
              const buttons: React.ReactNode[] = []

              // Top-level add path (only if 2+ top-level paths, i.e. top split exists)
              if (state.paths.length > 1) {
                const lastPath = state.paths[state.paths.length - 1]
                const lastBranchNodes = nodes.filter(n => n.pathId === lastPath.id && n.stepIndex !== undefined)
                const firstOfLast = lastBranchNodes.sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))[0]
                if (firstOfLast) {
                  buttons.push(
                    <button
                      key="add-path-top"
                      type="button"
                      data-canvas-node
                      style={{ position: "absolute", left: firstOfLast.x + FILTER_GAP, top: firstOfLast.y, zIndex: 15 }}
                      className="flex items-center justify-center size-12 rounded-xl border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40 text-xl hover:border-primary/40 hover:text-primary hover:bg-primary/5 bg-background transition-colors"
                      title="Add Path"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        setState(prev => {
                          const newState = {
                            ...prev,
                            paths: [...prev.paths, {
                              id: crypto.randomUUID(),
                              label: `Path ${prev.paths.length + 1}`,
                              conditions: [],
                              action: { assignmentType: null, assigneeId: null, assigneeName: null },
                              steps: [{ type: 'filter' as const, conditions: [] as ConditionGroup[] }],
                            }],
                          }
                          setNodes(buildNodesFromState(newState))
                          return newState
                        })
                      }}
                    >+</button>
                  )
                }
              }

              // Nested split add-path buttons
              for (const { parentPathId, stepIndex, split } of flattenAllSplits(state.paths)) {
                if (split.paths.length < 1) continue
                const lastSubPath = split.paths[split.paths.length - 1]
                const lastSubNodes = nodes.filter(n => n.pathId === lastSubPath.id && n.stepIndex !== undefined)
                const firstOfLastSub = lastSubNodes.sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0))[0]
                if (!firstOfLastSub) continue
                buttons.push(
                  <button
                    key={`add-path-${parentPathId}-${stepIndex}`}
                    type="button"
                    data-canvas-node
                    style={{ position: "absolute", left: firstOfLastSub.x + FILTER_GAP, top: firstOfLastSub.y, zIndex: 15 }}
                    className="flex items-center justify-center size-12 rounded-xl border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40 text-xl hover:border-primary/40 hover:text-primary hover:bg-primary/5 bg-background transition-colors"
                    title="Add Sub-Path"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      setState(prev => {
                        const newState = {
                          ...prev,
                          paths: updateSplitStep(prev.paths, parentPathId, stepIndex, (s) => ({
                            ...s,
                            paths: [...s.paths, {
                              id: crypto.randomUUID(),
                              label: `Sub-Path ${s.paths.length + 1}`,
                              conditions: [],
                              action: { assignmentType: null, assigneeId: null, assigneeName: null },
                              steps: [{ type: 'filter' as const, conditions: [] as ConditionGroup[] }],
                            }],
                          })),
                        }
                        setNodes(buildNodesFromState(newState))
                        return newState
                      })
                    }}
                  >+</button>
                )
              }

              return buttons
            })()}

            {/* "Add Step" dropdown menu */}
            {addStepDropdown && (
              <div
                data-canvas-node
                data-add-step-dropdown
                style={{
                  position: "absolute",
                  left: addStepDropdown.x,
                  top: addStepDropdown.y,
                  zIndex: 60,
                  width: 180,
                }}
                className="rounded-lg border bg-white dark:bg-[#1a1a24] shadow-lg p-1"
              >
                {(
                  [
                    { type: "filter" as PathStepType, label: "Filter", icon: Filter },
                    { type: "updateField" as PathStepType, label: "Update Field", icon: Pencil },
                    { type: "createTask" as PathStepType, label: "Create Task", icon: ClipboardList },
                    { type: "assign" as PathStepType, label: "Assignment", icon: UserCheck },
                    { type: "split" as PathStepType, label: "Split", icon: GitBranch },
                  ] as const
                ).map((item) => {
                  const ItemIcon = item.icon
                  return (
                    <button
                      key={item.type}
                      type="button"
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors text-left"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAddStepToPath(addStepDropdown.pathId, item.type)
                      }}
                    >
                      <ItemIcon className="size-3.5 text-muted-foreground" />
                      {item.label}
                    </button>
                  )
                })}
                <button
                  type="button"
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs rounded-md text-muted-foreground hover:bg-muted transition-colors text-left mt-1 border-t pt-2"
                  onClick={(e) => {
                    e.stopPropagation()
                    setAddStepDropdown(null)
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
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
        <StepRegistry activeTypes={activeTypes} onAddStep={addStepToCanvas} />
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
            ? (findPathById(state.paths, activeFilterPathId)?.label ?? "Path")
            : "Path"
        }
        conditions={
          activeFilterPathId
            ? (findPathById(state.paths, activeFilterPathId)?.conditions ?? [])
            : []
        }
        objectType={resolveObjectType(state)}
        onSave={(conditions: RuleConditions) => {
          if (!activeFilterPathId) return
          const pathId = activeFilterPathId
          setState((s) => ({
            ...s,
            paths: updatePathById(s.paths, pathId, (p) => {
              if (p.steps && p.steps.length > 0) {
                // V2: steps[0].conditions is the single source of truth
                const idx = p.steps.findIndex(st => st.type === "filter")
                if (idx >= 0) {
                  const newSteps = [...p.steps]
                  newSteps[idx] = { type: "filter", conditions } as any
                  return { ...p, steps: newSteps, conditions }
                }
              }
              // Legacy: path.conditions only
              return { ...p, conditions }
            }),
          }))
        }}
        onLabelChange={(label: string) => {
          if (!activeFilterPathId) return
          const pathId = activeFilterPathId
          setState((s) => ({
            ...s,
            paths: updatePathById(s.paths, pathId, (p) => ({ ...p, label })),
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
            ? (findPathById(state.paths, activeAssignPathId)?.label ?? "Path")
            : "Path"
        }
        action={
          activeAssignPathId
            ? (findPathById(state.paths, activeAssignPathId)?.action ?? {
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
            paths: updatePathById(s.paths, pathId, (p) => ({ ...p, action })),
          }))
        }}
      />

      {/* Update Field sheet */}
      <UpdateFieldConfigSheet
        key={activeSheet?.type === "updateField" ? `uf-${activeSheet.pathId}-${activeSheet.stepIndex}` : "uf-closed"}
        open={activeSheet?.type === "updateField"}
        onOpenChange={(open) => !open && closeSheet()}
        fieldApiName={
          activeSheet?.type === "updateField"
            ? ((findPathById(state.paths, activeSheet.pathId)?.steps?.[activeSheet.stepIndex] as { type: "updateField"; fieldApiName: string } | undefined)?.fieldApiName ?? "")
            : ""
        }
        fieldValue={
          activeSheet?.type === "updateField"
            ? ((findPathById(state.paths, activeSheet.pathId)?.steps?.[activeSheet.stepIndex] as { type: "updateField"; fieldValue: string } | undefined)?.fieldValue ?? "")
            : ""
        }
        fields={[]}
        onSave={(fieldApiName: string, fieldValue: string) => {
          if (activeSheet?.type !== "updateField") return
          const { pathId, stepIndex } = activeSheet
          setState((s) => ({
            ...s,
            paths: updatePathById(s.paths, pathId, (p) => {
              if (!p.steps) return p
              const newSteps = [...p.steps]
              newSteps[stepIndex] = { type: "updateField", fieldApiName, fieldValue }
              return { ...p, steps: newSteps }
            }),
          }))
        }}
      />

      {/* Create Task sheet */}
      <CreateTaskConfigSheet
        key={activeSheet?.type === "createTask" ? `ct-${activeSheet.pathId}-${activeSheet.stepIndex}` : "ct-closed"}
        open={activeSheet?.type === "createTask"}
        onOpenChange={(open) => !open && closeSheet()}
        config={
          activeSheet?.type === "createTask"
            ? (() => {
                const step = findPathById(state.paths, activeSheet.pathId)?.steps?.[activeSheet.stepIndex]
                if (step?.type === "createTask") return { subject: step.subject, priority: step.priority, status: step.status, dueDateOffset: step.dueDateOffset, description: step.description }
                return { subject: "", priority: "Normal", status: "Not Started", dueDateOffset: null, description: "" }
              })()
            : { subject: "", priority: "Normal", status: "Not Started", dueDateOffset: null, description: "" }
        }
        onSave={(config) => {
          if (activeSheet?.type !== "createTask") return
          const { pathId, stepIndex } = activeSheet
          setState((s) => ({
            ...s,
            paths: updatePathById(s.paths, pathId, (p) => {
              if (!p.steps) return p
              const newSteps = [...p.steps]
              newSteps[stepIndex] = {
                type: "createTask",
                subject: config.subject,
                priority: config.priority as "High" | "Normal" | "Low",
                status: config.status as "Not Started" | "In Progress" | "Completed",
                dueDateOffset: config.dueDateOffset,
                description: config.description,
              }
              return { ...p, steps: newSteps }
            }),
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
