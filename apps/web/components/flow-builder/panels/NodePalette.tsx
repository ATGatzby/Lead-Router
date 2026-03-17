"use client"

import { useState } from "react"
import { Search, ArrowUp, GitBranch, GitFork, Filter, Search as SearchIcon, UserPlus, Shield, Pencil, ClipboardList, Clock } from "lucide-react"
import type { FlowNodeType, NodePaletteItem } from "../types"
import { NODE_PALETTE } from "../types"

const ICON_MAP: Record<string, React.ElementType> = {
  "arrow-up": ArrowUp,
  "git-branch": GitBranch,
  "git-fork": GitFork,
  filter: Filter,
  search: SearchIcon,
  "user-plus": UserPlus,
  shield: Shield,
  pencil: Pencil,
  "clipboard-list": ClipboardList,
  clock: Clock,
}

const CATEGORY_LABELS: Record<string, string> = {
  triggers: "Triggers",
  logic: "Logic",
  matching: "Matching",
  actions: "Actions",
  advanced: "Advanced",
}

interface NodePaletteProps {
  onDragStart: (type: FlowNodeType) => void
}

export function NodePalette({ onDragStart }: NodePaletteProps) {
  const [search, setSearch] = useState("")

  const filtered = NODE_PALETTE.filter(
    item => item.label.toLowerCase().includes(search.toLowerCase()) || item.description.toLowerCase().includes(search.toLowerCase())
  )

  const categories = [...new Set(filtered.map(i => i.category))]

  return (
    <div className="w-[220px] bg-zinc-900 border-r border-zinc-800 flex flex-col h-full">
      <div className="p-3 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Nodes</div>
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-zinc-800 border border-zinc-700/50">
          <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <input
            type="text"
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none w-full"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {categories.map(cat => (
          <div key={cat} className="mt-3 first:mt-1">
            <div className="text-[9px] font-bold uppercase tracking-widest text-zinc-600 px-2 mb-1">{CATEGORY_LABELS[cat] ?? cat}</div>
            {filtered.filter(i => i.category === cat).map(item => {
              const Icon = ICON_MAP[item.icon] ?? ArrowUp
              return (
                <div
                  key={item.type}
                  draggable={!item.disabled}
                  onDragStart={e => {
                    e.dataTransfer.setData("application/reactflow-type", item.type)
                    e.dataTransfer.effectAllowed = "move"
                    onDragStart(item.type)
                  }}
                  className={`flex items-center gap-2.5 px-2 py-2 rounded-lg cursor-grab active:cursor-grabbing transition-colors mb-0.5 ${item.disabled ? "opacity-30 cursor-not-allowed" : "hover:bg-zinc-800"}`}
                >
                  <div className="w-7 h-7 rounded-md bg-zinc-800 border border-zinc-700/50 flex items-center justify-center shrink-0">
                    <Icon className="w-3.5 h-3.5 text-zinc-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-zinc-300">{item.label}</div>
                    <div className="text-[10px] text-zinc-600 truncate">{item.description}</div>
                  </div>
                  {item.badge && (
                    <span className="text-[8px] font-bold uppercase bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded">{item.badge}</span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
