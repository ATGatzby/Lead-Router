"use client"
import { memo } from "react"
import { Handle, Position, useReactFlow } from "@xyflow/react"
import { PenLine, X } from "lucide-react"
import { cn } from "@/lib/utils"

function UpdateFieldNodeComponent({ id, data, selected }: { id: string; data: any; selected?: boolean }) {
  const { deleteElements } = useReactFlow()
  const config = data.config ?? {}
  const hasField = !!config.fieldApiName

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white shadow-sm min-w-[240px] max-w-[280px] transition-all",
        "border-l-4 border-l-yellow-500",
        selected && "ring-2 ring-yellow-500/40 shadow-md"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-shrink-0 flex items-center justify-center size-9 rounded-full bg-yellow-50">
          <PenLine className="size-4 text-yellow-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800">Update Field</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            {hasField ? `${config.fieldApiName} = "${config.fieldValue || ""}"` : "Set value mid-flow"}
          </p>
        </div>
        <button
          className="text-zinc-300 hover:text-zinc-500 transition p-0.5"
          onMouseDown={e => { e.stopPropagation(); deleteElements({ nodes: [{ id }] }) }}
        >
          <X className="size-3.5" />
        </button>
      </div>
      <Handle type="target" position={Position.Top} className="!bg-yellow-500 !w-2.5 !h-2.5 !border-2 !border-white" />
      <Handle type="source" position={Position.Bottom} className="!bg-yellow-500 !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  )
}

export const UpdateFieldNode = memo(UpdateFieldNodeComponent)
