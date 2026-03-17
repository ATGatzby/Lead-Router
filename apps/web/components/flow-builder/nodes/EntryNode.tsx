"use client"
import { memo } from "react"
import { Handle, Position, useReactFlow } from "@xyflow/react"
import { Zap, X } from "lucide-react"
import { cn } from "@/lib/utils"

function EntryNodeComponent({ id, data, selected }: { id: string; data: any; selected?: boolean }) {
  const { deleteElements } = useReactFlow()
  const config = data.config ?? {}
  const event = config.triggerEvent === "INSERT" ? "Created" : config.triggerEvent === "UPDATE" ? "Updated" : "Created or Updated"
  const obj = config.objectType === "CONTACT" ? "Contact" : config.objectType === "ACCOUNT" ? "Account" : "Lead"

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white shadow-sm min-w-[240px] max-w-[280px] transition-all",
        "border-l-4 border-l-emerald-500",
        selected && "ring-2 ring-emerald-500/40 shadow-md"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-shrink-0 flex items-center justify-center size-9 rounded-full bg-emerald-50">
          <Zap className="size-4 text-emerald-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800">Trigger</p>
          <p className="text-xs text-zinc-400 mt-0.5">{obj} {event}</p>
        </div>
        <button
          className="text-zinc-300 hover:text-zinc-500 transition p-0.5"
          onMouseDown={e => { e.stopPropagation(); deleteElements({ nodes: [{ id }] }) }}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {config.triggerConditions?.length > 0 && (
        <div className="px-4 pb-3 -mt-1">
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
            {config.triggerConditions.length} condition{config.triggerConditions.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500 !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  )
}

export const EntryNode = memo(EntryNodeComponent)
