"use client"
import { memo } from "react"
import { Handle, Position, useReactFlow } from "@xyflow/react"
import { GitFork, X } from "lucide-react"
import { cn } from "@/lib/utils"

function BranchDecisionNodeComponent({ id, data, selected }: { id: string; data: any; selected?: boolean }) {
  const { deleteElements } = useReactFlow()
  const config = data.config ?? {}
  const branches = config.branches ?? []
  const allBranches = [...branches.map((b: any) => b.label), config.defaultLabel ?? "Default"]

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white shadow-sm min-w-[240px] max-w-[320px] transition-all",
        "border-l-4 border-l-violet-500",
        selected && "ring-2 ring-violet-500/40 shadow-md"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-shrink-0 flex items-center justify-center size-9 rounded-full bg-violet-50">
          <GitFork className="size-4 text-violet-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800">Branch</p>
          <p className="text-xs text-zinc-400 mt-0.5">{config.fieldApiName ?? "Select field"}</p>
        </div>
        <button
          className="text-zinc-300 hover:text-zinc-500 transition p-0.5"
          onMouseDown={e => { e.stopPropagation(); deleteElements({ nodes: [{ id }] }) }}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {allBranches.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3 -mt-1">
          {allBranches.map((label: string, i: number) => (
            <span key={i} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">{label}</span>
          ))}
        </div>
      )}
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-2.5 !h-2.5 !border-2 !border-white" />
      {allBranches.map((_: string, i: number) => (
        <Handle key={i} type="source" position={Position.Bottom} id={`branch-${i}`} style={{ left: `${((i + 1) / (allBranches.length + 1)) * 100}%` }} className="!bg-violet-500 !w-2.5 !h-2.5 !border-2 !border-white" />
      ))}
    </div>
  )
}

export const BranchDecisionNode = memo(BranchDecisionNodeComponent)
