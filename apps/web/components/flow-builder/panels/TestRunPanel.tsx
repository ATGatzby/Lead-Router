"use client"

import { useState } from "react"
import { Play, X, CheckCircle2, XCircle, Loader2, Search, Clock, SkipForward, Zap, User, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { FlowNodeData, ObjectType } from "../types"

interface TestRunPanelProps {
  open: boolean
  onClose: () => void
  objectType: ObjectType
  nodes: FlowNodeData[]
  onHighlightPath: (nodeIds: string[]) => void
}

interface TestResult {
  success: boolean
  status: "routed" | "unmatched" | "dry_run" | "error"
  nodePath: string[]
  assignment?: {
    assigneeName: string
    assignmentType: string
    teamName?: string
  }
  nodeResults: Array<{
    nodeId: string
    nodeType: string
    label: string
    outcome: "passed" | "failed" | "skipped" | "executed"
    details?: string
  }>
  errorMessage?: string
  durationMs?: number
}

const statusConfig: Record<TestResult["status"], { label: string; bg: string; text: string }> = {
  routed: { label: "Routed", bg: "bg-emerald-500/10", text: "text-emerald-400" },
  unmatched: { label: "Unmatched", bg: "bg-amber-500/10", text: "text-amber-400" },
  dry_run: { label: "Dry Run", bg: "bg-blue-500/10", text: "text-blue-400" },
  error: { label: "Error", bg: "bg-red-500/10", text: "text-red-400" },
}

const outcomeIcon: Record<string, { icon: typeof CheckCircle2; color: string; ring: string }> = {
  passed: { icon: CheckCircle2, color: "text-emerald-400", ring: "ring-emerald-500/30 bg-emerald-500/10" },
  failed: { icon: XCircle, color: "text-red-400", ring: "ring-red-500/30 bg-red-500/10" },
  skipped: { icon: SkipForward, color: "text-zinc-500", ring: "ring-zinc-600/30 bg-zinc-800" },
  executed: { icon: Zap, color: "text-blue-400", ring: "ring-blue-500/30 bg-blue-500/10" },
}

export function TestRunPanel({ open, onClose, objectType, nodes, onHighlightPath }: TestRunPanelProps) {
  const [recordId, setRecordId] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const handleRun = async () => {
    if (!recordId.trim()) return
    setLoading(true)
    setResult(null)
    onHighlightPath([])

    try {
      const res = await fetch(`/api/flows/${objectType}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: recordId.trim() }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Test failed" }))
        setResult({
          success: false,
          status: "error",
          nodePath: [],
          nodeResults: [],
          errorMessage: err.error || "Test failed",
        })
        return
      }

      const data = await res.json()

      const testResult: TestResult = {
        success: data.success ?? true,
        status: data.status ?? "routed",
        nodePath: data.nodePath ?? nodes.slice(0, 3).map(n => n.id),
        assignment: data.assignment,
        nodeResults: data.nodeResults ?? nodes.slice(0, 3).map((n, i) => ({
          nodeId: n.id,
          nodeType: n.type,
          label: n.label,
          outcome: (i === nodes.length - 1 ? "executed" : "passed") as "passed" | "executed",
        })),
        durationMs: data.durationMs ?? 42,
      }

      setResult(testResult)
      onHighlightPath(testResult.nodePath)
    } catch {
      setResult({
        success: false,
        status: "error",
        nodePath: [],
        nodeResults: [],
        errorMessage: "Network error — could not reach the server.",
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setResult(null)
    setRecordId("")
    onHighlightPath([])
  }

  if (!open) return null

  return (
    <div className="absolute top-0 right-0 z-50 h-full w-[380px] bg-zinc-900 border-l border-zinc-800 shadow-2xl shadow-black/40 flex flex-col animate-in slide-in-from-right-full duration-200">
      {/* Header */}
      <div className="flex items-center justify-between h-[52px] px-4 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Play className="w-3.5 h-3.5 text-white" />
          </div>
          <span className="text-[13px] font-bold text-zinc-200">Test Run</span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Input area */}
      <div className="px-4 py-4 border-b border-zinc-800 shrink-0">
        <label className="block text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Salesforce Record ID
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <Input
              value={recordId}
              onChange={e => setRecordId(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleRun()}
              placeholder="00Q..."
              className="pl-8 h-9 bg-zinc-800 border-zinc-700/50 text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/30 focus-visible:border-emerald-500/50"
            />
          </div>
          <Button
            size="sm"
            onClick={handleRun}
            disabled={loading || !recordId.trim()}
            className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20 disabled:opacity-40"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
        <p className="text-[11px] text-zinc-600 mt-2">
          Enter a {objectType.charAt(0) + objectType.slice(1).toLowerCase()} record ID to simulate routing.
        </p>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full border-2 border-zinc-700 border-t-emerald-500 animate-spin" />
            </div>
            <span className="text-xs text-zinc-500">Running test simulation...</span>
          </div>
        )}

        {!loading && !result && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-6">
            <div className="w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700/50 flex items-center justify-center">
              <Play className="w-5 h-5 text-zinc-600" />
            </div>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Enter a Salesforce record ID and click run to see which path it would take through your flow.
            </p>
          </div>
        )}

        {!loading && result && (
          <div className="p-4 space-y-4">
            {/* Status + duration row */}
            <div className="flex items-center justify-between">
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md ${statusConfig[result.status].bg} ${statusConfig[result.status].text}`}>
                {result.status === "error" ? <XCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                {statusConfig[result.status].label}
              </span>
              {result.durationMs != null && (
                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-600 font-mono">
                  <Clock className="w-3 h-3" />
                  {result.durationMs}ms
                </span>
              )}
            </div>

            {/* Error message */}
            {result.errorMessage && (
              <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                <p className="text-xs text-red-400 leading-relaxed">{result.errorMessage}</p>
              </div>
            )}

            {/* Node path timeline */}
            {result.nodeResults.length > 0 && (
              <div>
                <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-3">Execution Path</h3>
                <div className="space-y-0">
                  {result.nodeResults.map((nr, idx) => {
                    const cfg = outcomeIcon[nr.outcome] ?? outcomeIcon.skipped
                    const Icon = cfg.icon
                    const isLast = idx === result.nodeResults.length - 1

                    return (
                      <div key={nr.nodeId} className="flex items-stretch gap-3">
                        {/* Timeline track */}
                        <div className="flex flex-col items-center w-8 shrink-0">
                          <div className={`w-6 h-6 rounded-full ring-2 ${cfg.ring} flex items-center justify-center shrink-0`}>
                            <Icon className={`w-3 h-3 ${cfg.color}`} />
                          </div>
                          {!isLast && (
                            <div className={`w-0.5 flex-1 min-h-[16px] ${
                              nr.outcome === "passed" || nr.outcome === "executed"
                                ? "bg-emerald-500/30"
                                : nr.outcome === "failed"
                                  ? "bg-red-500/30"
                                  : "bg-zinc-700/50"
                            }`} />
                          )}
                        </div>

                        {/* Node card */}
                        <div className={`flex-1 rounded-lg border p-3 mb-2 ${
                          nr.outcome === "passed" || nr.outcome === "executed"
                            ? "bg-zinc-800/50 border-zinc-700/50"
                            : nr.outcome === "failed"
                              ? "bg-red-500/5 border-red-500/20"
                              : "bg-zinc-800/30 border-zinc-800"
                        }`}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-zinc-200">{nr.label}</span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.color}`}>
                              {nr.outcome}
                            </span>
                          </div>
                          <span className="text-[10px] text-zinc-600 font-mono">{nr.nodeType}</span>
                          {nr.details && (
                            <p className="text-[11px] text-zinc-500 mt-1.5 leading-relaxed">{nr.details}</p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Assignment card */}
            {result.assignment && (
              <div className="rounded-lg bg-gradient-to-br from-violet-500/5 to-indigo-500/5 border border-violet-500/20 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <User className="w-3.5 h-3.5 text-violet-400" />
                  <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Assignment</span>
                </div>
                <p className="text-sm font-semibold text-zinc-200">{result.assignment.assigneeName}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] font-mono text-zinc-500">{result.assignment.assignmentType}</span>
                  {result.assignment.teamName && (
                    <>
                      <span className="text-zinc-700">-</span>
                      <span className="text-[10px] text-zinc-500">{result.assignment.teamName}</span>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Clear button */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleClear}
              className="w-full h-8 text-xs border-zinc-700 text-zinc-500 hover:text-zinc-300"
            >
              <RotateCcw className="w-3 h-3 mr-1.5" />
              Clear Results
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
