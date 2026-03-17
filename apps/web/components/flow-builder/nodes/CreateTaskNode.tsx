"use client"
import { memo } from "react"
import { Handle, Position, useReactFlow } from "@xyflow/react"
import { ClipboardList, X } from "lucide-react"
import { cn } from "@/lib/utils"

function CreateTaskNodeComponent({ id, data, selected }: { id: string; data: any; selected?: boolean }) {
  const { deleteElements } = useReactFlow()
  const config = data.config ?? {}

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white shadow-sm min-w-[240px] max-w-[280px] transition-all",
        "border-l-4 border-l-sky-500",
        selected && "ring-2 ring-sky-500/40 shadow-md"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-shrink-0 flex items-center justify-center size-9 rounded-full bg-sky-50">
          <ClipboardList className="size-4 text-sky-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800">Create Task</p>
          <p className="text-xs text-zinc-400 mt-0.5">{config.subject || "Follow up with lead"}</p>
        </div>
        <button
          className="text-zinc-300 hover:text-zinc-500 transition p-0.5"
          onMouseDown={e => { e.stopPropagation(); deleteElements({ nodes: [{ id }] }) }}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {(config.priority || config.dueDateOffset) && (
        <div className="flex gap-1.5 px-4 pb-3 -mt-1">
          {config.priority && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700">{config.priority}</span>
          )}
          {config.dueDateOffset && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-500">Due in {config.dueDateOffset}d</span>
          )}
        </div>
      )}
      <Handle type="target" position={Position.Top} className="!bg-sky-500 !w-2.5 !h-2.5 !border-2 !border-white" />
      <Handle type="source" position={Position.Bottom} className="!bg-sky-500 !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  )
}

export const CreateTaskNode = memo(CreateTaskNodeComponent)
