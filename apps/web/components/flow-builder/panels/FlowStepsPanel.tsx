"use client"

import { Zap, GitBranch, GitFork, Filter, Search, UserCheck, ShieldAlert, PenLine, ClipboardList } from "lucide-react"
import type { FlowNodeType } from "../types"
import { NODE_PALETTE } from "../types"

const ICON_MAP: Record<string, React.ElementType> = {
  "arrow-up": Zap,
  "git-branch": GitBranch,
  "git-fork": GitFork,
  filter: Filter,
  search: Search,
  "user-plus": UserCheck,
  shield: ShieldAlert,
  pencil: PenLine,
  "clipboard-list": ClipboardList,
}

const ICON_COLORS: Record<string, { bg: string; text: string }> = {
  ENTRY: { bg: "bg-emerald-50", text: "text-emerald-600" },
  DECISION: { bg: "bg-violet-50", text: "text-violet-600" },
  BRANCH_DECISION: { bg: "bg-violet-50", text: "text-violet-600" },
  FILTER: { bg: "bg-indigo-50", text: "text-indigo-600" },
  MATCH: { bg: "bg-blue-50", text: "text-blue-600" },
  ASSIGNMENT: { bg: "bg-green-50", text: "text-green-600" },
  DEFAULT: { bg: "bg-amber-50", text: "text-amber-600" },
  UPDATE_FIELD: { bg: "bg-yellow-50", text: "text-yellow-600" },
  CREATE_TASK: { bg: "bg-sky-50", text: "text-sky-600" },
}

const CATEGORY_LABELS: Record<string, string> = {
  triggers: "Triggers",
  logic: "Logic",
  matching: "Matching",
  actions: "Actions",
  advanced: "Advanced",
}

interface FlowStepsPanelProps {
  /** Set of node types already in the flow (to show "added" for singletons like ENTRY) */
  existingTypes?: Set<FlowNodeType>
}

export function FlowStepsPanel({ existingTypes }: FlowStepsPanelProps) {
  const categories = [...new Set(NODE_PALETTE.map(i => i.category))]

  const entryAdded = existingTypes?.has("ENTRY")

  return (
    <div className="w-[260px] bg-white border-l border-zinc-200 flex flex-col h-full overflow-y-auto">
      <div className="px-5 pt-5 pb-3">
        <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Steps</p>
      </div>

      {categories.map(cat => {
        const items = NODE_PALETTE.filter(i => i.category === cat)
        return (
          <div key={cat} className="px-4 pb-1 mt-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-300 px-2 mb-1">{CATEGORY_LABELS[cat] ?? cat}</p>
            {items.map(item => {
              const Icon = ICON_MAP[item.icon] ?? Zap
              const colors = ICON_COLORS[item.type] ?? { bg: "bg-zinc-50", text: "text-zinc-600" }
              const isEntryAdded = item.type === "ENTRY" && entryAdded

              return (
                <div
                  key={item.type}
                  draggable={!isEntryAdded}
                  onDragStart={e => {
                    e.dataTransfer.setData("application/reactflow-type", item.type)
                    e.dataTransfer.effectAllowed = "move"
                  }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-grab active:cursor-grabbing transition-all mb-0.5 border border-transparent
                    ${isEntryAdded ? "opacity-50 cursor-default" : "hover:bg-zinc-50 hover:border-zinc-200"}`}
                >
                  <div className={`flex-shrink-0 flex items-center justify-center size-9 rounded-full ${colors.bg}`}>
                    <Icon className={`size-4 ${colors.text}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-medium text-zinc-700">{item.label}</span>
                      {isEntryAdded && (
                        <span className="text-[10px] text-zinc-400 font-normal">(added)</span>
                      )}
                    </div>
                    <p className="text-[11px] text-zinc-400 truncate">{item.description}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
