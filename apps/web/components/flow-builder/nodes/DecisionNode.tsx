"use client"
import { memo } from "react"
import { Handle, Position, useReactFlow } from "@xyflow/react"
import { GitBranch, X } from "lucide-react"
import { cn } from "@/lib/utils"

function DecisionNodeComponent({ id, data, selected }: { id: string; data: any; selected?: boolean }) {
  const { deleteElements } = useReactFlow()
  const config = data.config ?? {}
  const conditions = config.conditions ?? []
  const firstCond = conditions[0]?.conditions?.[0]
  const condText = firstCond
    ? `${firstCond.fieldApiName ?? firstCond.fieldName} ${firstCond.operator}`
    : "No condition"

  return (
    <div className="relative w-[200px] h-[200px]">
      {/* Diamond shape */}
      <div
        className={cn(
          "absolute inset-[16px] rotate-45 rounded-2xl border-2 bg-white shadow-sm transition-all",
          selected
            ? "border-violet-500 ring-2 ring-violet-500/30 shadow-md"
            : "border-violet-300 hover:border-violet-400"
        )}
      >
        {/* Content counter-rotated */}
        <div className="-rotate-45 absolute inset-0 flex flex-col items-center justify-center text-center px-3 gap-1">
          <div className="flex items-center justify-center size-8 rounded-full bg-violet-50 mb-0.5">
            <GitBranch className="size-3.5 text-violet-600" />
          </div>
          <span className="text-[11px] font-bold text-zinc-800">{data.label || "Decision"}</span>
          <span className="text-[9px] text-zinc-400 font-medium leading-tight max-w-[100px] truncate">{condText}</span>
        </div>
      </div>

      {/* X button (top right, outside diamond) */}
      <button
        className="absolute top-0 right-0 z-20 text-zinc-300 hover:text-zinc-500 transition p-0.5"
        onMouseDown={e => { e.stopPropagation(); deleteElements({ nodes: [{ id }] }) }}
      >
        <X className="size-3.5" />
      </button>

      {/* Yes / No labels */}
      <div className="absolute -bottom-2 left-3 text-[8px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5 z-10">Yes</div>
      <div className="absolute -bottom-2 right-3 text-[8px] font-bold uppercase tracking-wider text-red-600 bg-red-50 border border-red-200 rounded px-1.5 py-0.5 z-10">No</div>

      {/* Handles */}
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-2.5 !h-2.5 !border-2 !border-white" />
      <Handle type="source" position={Position.Bottom} id="true" style={{ left: "30%" }} className="!bg-emerald-500 !w-2.5 !h-2.5 !border-2 !border-white" />
      <Handle type="source" position={Position.Bottom} id="false" style={{ left: "70%" }} className="!bg-red-500 !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  )
}

export const DecisionNode = memo(DecisionNodeComponent)
