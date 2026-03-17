"use client"
import { memo } from "react"
import { Handle, Position, useReactFlow } from "@xyflow/react"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

function MatchNodeComponent({ id, data, selected }: { id: string; data: any; selected?: boolean }) {
  const { deleteElements } = useReactFlow()
  const config = data.config ?? {}
  const objects = [config.checkLeads && "Leads", config.checkContacts && "Contacts", config.checkAccounts && "Accounts"].filter(Boolean)
  const fields = [config.matchEmail && "Email", config.matchPhone && "Phone", config.matchDomain && "Domain", config.matchCompanyName && "Company"].filter(Boolean)
  const subtitle = objects.length > 0 ? `Check ${objects.join(", ")}` : "Check for existing records"

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white shadow-sm min-w-[240px] max-w-[280px] transition-all",
        "border-l-4 border-l-blue-500",
        selected && "ring-2 ring-blue-500/40 shadow-md"
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-shrink-0 flex items-center justify-center size-9 rounded-full bg-blue-50">
          <Search className="size-4 text-blue-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-800">Match</p>
          <p className="text-xs text-zinc-400 mt-0.5">{subtitle}</p>
        </div>
        <button
          className="text-zinc-300 hover:text-zinc-500 transition p-0.5"
          onMouseDown={e => { e.stopPropagation(); deleteElements({ nodes: [{ id }] }) }}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {fields.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-3 -mt-1">
          {fields.map((f) => (
            <span key={f} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{f}</span>
          ))}
        </div>
      )}
      <Handle type="target" position={Position.Top} className="!bg-blue-500 !w-2.5 !h-2.5 !border-2 !border-white" />
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500 !w-2.5 !h-2.5 !border-2 !border-white" />
    </div>
  )
}

export const MatchNode = memo(MatchNodeComponent)
