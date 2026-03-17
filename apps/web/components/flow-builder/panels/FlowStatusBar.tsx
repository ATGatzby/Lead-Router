"use client"

import { AlertCircle, AlertTriangle, Info } from "lucide-react"
import type { FlowValidationWarning } from "../types"

interface FlowStatusBarProps {
  warnings: FlowValidationWarning[]
  nodeCount: number
  edgeCount: number
  onWarningClick?: (nodeId: string) => void
}

export function FlowStatusBar({ warnings, nodeCount, edgeCount }: FlowStatusBarProps) {
  const errors = warnings.filter(w => w.severity === "error").length
  const warns = warnings.filter(w => w.severity === "warning").length
  const infos = warnings.filter(w => w.severity === "info").length

  return (
    <div className="h-[32px] bg-white border-t border-zinc-200 flex items-center px-4 gap-4 text-[11px] text-zinc-400">
      <span>{nodeCount} node{nodeCount !== 1 ? "s" : ""}</span>
      <span>{edgeCount} edge{edgeCount !== 1 ? "s" : ""}</span>
      <div className="flex-1" />
      {errors > 0 && (
        <span className="flex items-center gap-1 text-red-500 bg-red-50 px-2 py-0.5 rounded-full font-semibold">
          <AlertCircle className="w-3 h-3" />{errors} error{errors !== 1 ? "s" : ""}
        </span>
      )}
      {warns > 0 && (
        <span className="flex items-center gap-1 text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full font-semibold">
          <AlertTriangle className="w-3 h-3" />{warns}
        </span>
      )}
      {infos > 0 && (
        <span className="flex items-center gap-1 text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full font-semibold">
          <Info className="w-3 h-3" />{infos}
        </span>
      )}
    </div>
  )
}
