"use client"
import { memo } from "react"
import { Handle, Position, useReactFlow } from "@xyflow/react"
import { Filter, X } from "lucide-react"
import { cn } from "@/lib/utils"

function FilterNodeComponent({ id, data, selected }: { id: string; data: any; selected?: boolean }) {
  const { deleteElements } = useReactFlow()
  const config = data.config ?? {}
  const condCount = (config.conditions ?? []).flatMap((g: any) => g.conditions ?? []).length

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white shadow-sm min-w-[240px] max-w-[280px] transition-all",
        "border-l-4 border-l-indigo-500",
        selected && "ring-2 ring-indigo-500/40 shadow-md"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-shrink-0 flex items-center justify-center size-9 rounded-full bg-indigo-50">
          <Filter className="size-4 text-indigo-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800">{data.label || "Filter"}</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {condCount > 0 ? `${condCount} condition${condCount !== 1 ? "s" : ""}` : "No conditions (catch-all)"}
          </p>
        </div>
        <button
          className="text-zinc-300 hover:text-zinc-500 transition p-0.5"
          onMouseDown={e => { e.stopPropagation(); deleteElements({ nodes: [{ id }] }) }}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <Handle type="target" position={Position.Top} className="!bg-indigo-500 !w-2.5 !h-2.5 !border-2 !border-white" />
      <Handle type="source" position={Position.Bottom} className="!bg-indigo-500 !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  )
}

export const FilterNode = memo(FilterNodeComponent)
