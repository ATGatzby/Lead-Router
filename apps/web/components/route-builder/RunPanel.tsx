"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Play, X, Loader2, Check, Search, Users, Filter, UserCheck, RotateCcw, CheckCircle2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCrmType } from "@/lib/hooks/use-crm-type"

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = "pending" | "active" | "done" | "error"
type RunningStep = "trigger" | "match" | "filter" | "assign" | null

interface WorkflowStep {
  id: string
  name: string
  detail: string
  status: StepStatus
  duration: string | null
  icon: typeof Search
  mapToStep: RunningStep
}

interface RunHistoryEntry {
  id: string
  date: string
  recordsRouted: number
  duration: string
  success: boolean
}

interface RunApiResponse {
  success: boolean
  recordsFound: number
  recordsRouted: number
  recordsDuplicate?: number
  durationMs: number
  message?: string
  error?: string
}

interface RouteStepsConfig {
  hasMatch: boolean
  hasPaths: boolean
  hasDefaultOwner: boolean
}

interface RunPanelProps {
  ruleId: string
  routeName: string
  isOpen: boolean
  onClose: () => void
  onRunningStepChange?: (step: RunningStep) => void
  onRunStateChange?: (isRunning: boolean) => void
  routeSteps?: RouteStepsConfig
}

// ─── Build workflow steps from route config ───────────────────────────────────

function buildSteps(config?: RouteStepsConfig, crmLabel = "Salesforce"): WorkflowStep[] {
  const steps: WorkflowStep[] = [
    { id: "query", name: `Query ${crmLabel}`, detail: "Search for matching records", status: "pending", duration: null, icon: Search, mapToStep: "trigger" },
  ]
  if (config?.hasMatch) {
    steps.push({ id: "match", name: "Match & Deduplicate", detail: "Check for existing leads & contacts", status: "pending", duration: null, icon: Users, mapToStep: "match" })
  }
  if (config?.hasPaths) {
    steps.push({ id: "filter", name: "Filter & Route", detail: "Apply routing rules to records", status: "pending", duration: null, icon: Filter, mapToStep: "filter" })
  }
  steps.push({ id: "assign", name: "Assign Owners", detail: `Update record ownership in ${crmLabel}`, status: "pending", duration: null, icon: UserCheck, mapToStep: "assign" })
  return steps
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${String(s).padStart(2, "0")}s`
}

// ─── RunPanel Component ───────────────────────────────────────────────────────

export function RunPanel({
  ruleId,
  routeName,
  isOpen,
  onClose,
  onRunningStepChange,
  onRunStateChange,
  routeSteps,
}: RunPanelProps) {
  const { crmLabel } = useCrmType()
  const [steps, setSteps] = useState<WorkflowStep[]>(() => buildSteps(routeSteps, crmLabel))
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [isRunning, setIsRunning] = useState(false)
  const [isComplete, setIsComplete] = useState(false)
  const [runResult, setRunResult] = useState<RunApiResponse | null>(null)
  const [history, setHistory] = useState<RunHistoryEntry[]>([])
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hasStartedRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)

  // Notify parent of running state changes
  useEffect(() => {
    onRunStateChange?.(isRunning)
  }, [isRunning, onRunStateChange])

  // Helper to animate progress bar smoothly
  const animateProgress = useCallback((from: number, to: number, duration: number): Promise<void> => {
    return new Promise((resolve) => {
      const start = performance.now()
      function frame(now: number) {
        const p = Math.min((now - start) / duration, 1)
        const eased = 1 - Math.pow(1 - p, 3) // ease-out cubic
        setProgress(from + (to - from) * eased)
        if (p < 1) {
          animFrameRef.current = requestAnimationFrame(frame)
        } else {
          resolve()
        }
      }
      animFrameRef.current = requestAnimationFrame(frame)
    })
  }, [])

  // Update a single step
  const updateStep = useCallback((id: string, updates: Partial<WorkflowStep>) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...updates } : s)))
  }, [])

  // Notify parent about active step changes
  const setRunningStep = useCallback((step: RunningStep) => {
    onRunningStepChange?.(step)
  }, [onRunningStepChange])

  // Start the run — fires API and animates progress in parallel
  const startRun = useCallback(async () => {
    if (isRunning) return
    setIsRunning(true)
    setIsComplete(false)
    setRunResult(null)
    setProgress(0)
    setElapsed(0)
    setSteps(buildSteps(routeSteps, crmLabel))

    // Start elapsed timer
    elapsedRef.current = setInterval(() => {
      setElapsed((e) => e + 1)
    }, 1000)

    // ── Phase 1: Query Salesforce — animate while API call runs ──
    updateStep("query", { status: "active", detail: `Connecting to ${crmLabel}...` })
    setRunningStep("trigger")

    // Fire API call and animate in parallel
    const apiPromise = fetch(`/api/rules/${ruleId}/run`, { method: "POST" })
      .then(async (res) => {
        const data = await res.json()
        return data as RunApiResponse
      })
      .catch((err) => ({
        success: false,
        recordsFound: 0,
        recordsRouted: 0,
        durationMs: 0,
        error: err instanceof Error ? err.message : "Network error",
      } as RunApiResponse))

    // Animate query phase (0 → 15%)
    await animateProgress(0, 15, 800)

    // Wait for API response
    const result = await apiPromise
    setRunResult(result)

    if (!result.success) {
      // API failed — show error and stop
      updateStep("query", {
        status: "error",
        detail: result.error ?? `Failed to query ${crmLabel}`,
        duration: result.durationMs ? formatDurationMs(result.durationMs) : null,
      })
      setRunningStep(null)
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current)
        elapsedRef.current = null
      }
      setIsRunning(false)
      setIsComplete(true)
      return
    }

    const { recordsFound, recordsRouted, durationMs } = result

    // Query done
    updateStep("query", {
      status: "done",
      detail: `${recordsFound} records found via SOQL query`,
      duration: formatDurationMs(Math.min(durationMs, 2000)),
    })
    setRunningStep(null)
    await new Promise((r) => setTimeout(r, 200))

    if (recordsFound === 0) {
      // No records — mark remaining steps as done/skipped
      const currentSteps = buildSteps(routeSteps, crmLabel)
      for (const s of currentSteps) {
        if (s.id !== "query") {
          updateStep(s.id, { status: "done", detail: "No records to process", duration: "—" })
        }
      }
      setProgress(100)
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current)
        elapsedRef.current = null
      }
      setIsRunning(false)
      setIsComplete(true)
      return
    }

    // Build dynamic progress ranges based on which steps are present
    const hasMatch = routeSteps?.hasMatch ?? false
    const hasPaths = routeSteps?.hasPaths ?? false
    let progressCursor = 15 // after query

    // ── Phase 2: Match & Deduplicate (optional) ──
    if (hasMatch) {
      const matchEnd = progressCursor + 20
      updateStep("match", { status: "active", detail: "Checking for duplicates..." })
      setRunningStep("match")
      await animateProgress(progressCursor, matchEnd, 600)
      const dupes = result.recordsDuplicate ?? 0
      const unique = recordsFound - dupes
      updateStep("match", {
        status: "done",
        detail: dupes > 0 ? `${dupes} duplicates found, ${unique} unique records` : `${recordsFound} unique records`,
        duration: formatDurationMs(Math.round(durationMs * 0.1)),
      })
      setRunningStep(null)
      progressCursor = matchEnd
      await new Promise((r) => setTimeout(r, 200))
    }

    // ── Phase 3: Filter & Route (optional) ──
    if (hasPaths) {
      const filterEnd = 85
      const total = recordsFound
      updateStep("filter", { status: "active", detail: `0 / ${total} records processed` })
      setRunningStep("filter")

      const filterAnimDuration = Math.max(800, Math.min(3000, total * 10))
      const filterAnimStart = performance.now()
      const pStart = progressCursor
      await new Promise<void>((resolve) => {
        function filterFrame(now: number) {
          const p = Math.min((now - filterAnimStart) / filterAnimDuration, 1)
          setProgress(pStart + (filterEnd - pStart) * p)
          const recordsDone = Math.min(total, Math.round(total * p))
          updateStep("filter", { detail: `${recordsDone} / ${total} records processed` })
          if (p < 1) {
            animFrameRef.current = requestAnimationFrame(filterFrame)
          } else {
            resolve()
          }
        }
        animFrameRef.current = requestAnimationFrame(filterFrame)
      })

      updateStep("filter", {
        status: "done",
        detail: `${recordsRouted} records routed`,
        duration: formatDurationMs(Math.round(durationMs * 0.6)),
      })
      setRunningStep(null)
      progressCursor = filterEnd
      await new Promise((r) => setTimeout(r, 200))
    }

    // ── Final Phase: Assign Owners (→ 100%) ──
    updateStep("assign", { status: "active", detail: `Writing ownership to ${crmLabel}...` })
    setRunningStep("assign")
    await animateProgress(progressCursor, 100, 500)
    updateStep("assign", {
      status: "done",
      detail: `${recordsRouted} records assigned`,
      duration: formatDurationMs(Math.round(durationMs * 0.1)),
    })
    setRunningStep(null)

    // ── Complete ──
    if (elapsedRef.current) {
      clearInterval(elapsedRef.current)
      elapsedRef.current = null
    }

    setIsRunning(false)
    setIsComplete(true)

    // Add to history
    setHistory((prev) => [
      {
        id: `run-${Date.now()}`,
        date: "Just now",
        recordsRouted,
        duration: formatDurationMs(durationMs),
        success: true,
      },
      ...prev.slice(0, 4),
    ])
  }, [isRunning, ruleId, animateProgress, updateStep, setRunningStep, crmLabel, routeSteps])

  // Auto-start on open
  useEffect(() => {
    if (isOpen && !hasStartedRef.current && !isRunning && !isComplete) {
      hasStartedRef.current = true
      const t = setTimeout(() => startRun(), 150)
      return () => clearTimeout(t)
    }
    if (!isOpen) {
      hasStartedRef.current = false
    }
  }, [isOpen, isRunning, isComplete, startRun])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (elapsedRef.current) clearInterval(elapsedRef.current)
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  const formatElapsed = (seconds: number) => {
    const m = Math.floor(seconds / 60)
    const s = String(seconds % 60).padStart(2, "0")
    return `${m}:${s}`
  }

  return (
    <div
      className={[
        "absolute top-0 right-0 bottom-0 bg-white dark:bg-gray-950 border-l flex flex-col z-30 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        isOpen ? "translate-x-0" : "translate-x-full",
      ].join(" ")}
      style={{ width: 380, boxShadow: isOpen ? "-4px 0 24px rgba(0,0,0,0.08)" : "none" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Play className="size-4 text-teal-600 dark:text-teal-400" />
          Run Workflow
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Progress bar */}
        {(isRunning || isComplete) && (
          <div>
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div
                className={[
                  "h-full rounded-full transition-[width] duration-300 ease-out",
                  runResult && !runResult.success
                    ? "bg-gradient-to-r from-red-500 to-red-400 dark:from-red-600 dark:to-red-500"
                    : isComplete
                    ? "bg-gradient-to-r from-green-500 to-green-400 dark:from-green-600 dark:to-green-500"
                    : "bg-gradient-to-r from-teal-500 to-teal-300 dark:from-teal-600 dark:to-teal-400",
                ].join(" ")}
                style={{ width: `${Math.round(progress)}%` }}
              />
            </div>
            <div className="flex justify-between items-center mt-1.5">
              <span
                className={[
                  "text-xs font-bold font-mono",
                  runResult && !runResult.success
                    ? "text-red-600 dark:text-red-400"
                    : isComplete ? "text-green-600 dark:text-green-400" : "text-teal-600 dark:text-teal-400",
                ].join(" ")}
              >
                {Math.round(progress)}%
              </span>
              <span className="text-[11px] text-muted-foreground font-mono">
                {formatElapsed(elapsed)}
              </span>
            </div>
          </div>
        )}

        {/* Workflow steps */}
        <div className="space-y-0">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1
            return (
              <div key={step.id} className="flex items-start gap-3 relative pb-2.5 pt-2.5">
                {/* Vertical connector */}
                {!isLast && (
                  <div
                    className={[
                      "absolute left-[13px] top-[36px] bottom-0 w-0.5",
                      step.status === "done"
                        ? "bg-green-200 dark:bg-green-800"
                        : step.status === "active"
                        ? "bg-teal-200 dark:bg-teal-800"
                        : step.status === "error"
                        ? "bg-red-200 dark:bg-red-800"
                        : "bg-gray-200 dark:bg-gray-700",
                    ].join(" ")}
                  />
                )}

                {/* Step icon */}
                <div
                  className={[
                    "flex-shrink-0 flex items-center justify-center size-7 rounded-lg relative z-10",
                    step.status === "done"
                      ? "bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400"
                      : step.status === "active"
                      ? "bg-teal-100 dark:bg-teal-900 text-teal-600 dark:text-teal-400"
                      : step.status === "error"
                      ? "bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500",
                  ].join(" ")}
                >
                  {step.status === "active" ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : step.status === "done" ? (
                    <Check className="size-3 stroke-[3]" />
                  ) : step.status === "error" ? (
                    <AlertTriangle className="size-3" />
                  ) : (
                    <div className="size-2 rounded-full bg-current" />
                  )}
                </div>

                {/* Step info */}
                <div className="flex-1 min-w-0">
                  <div
                    className={[
                      "text-xs font-semibold",
                      step.status === "pending" ? "text-muted-foreground"
                        : step.status === "error" ? "text-red-600 dark:text-red-400"
                        : "text-foreground",
                    ].join(" ")}
                  >
                    {step.name}
                  </div>
                  <div className={[
                    "text-[11px] mt-0.5",
                    step.status === "error" ? "text-red-500 dark:text-red-400" : "text-muted-foreground",
                  ].join(" ")}>
                    {step.detail}
                  </div>
                </div>

                {/* Duration */}
                {step.duration && (
                  <span className="text-[11px] text-muted-foreground font-mono flex-shrink-0 mt-0.5">
                    {step.duration}
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Summary box */}
        {isComplete && runResult && (
          <div className={[
            "rounded-lg border p-4 animate-in fade-in duration-400",
            runResult.success
              ? "border-green-100 dark:border-green-900 bg-green-50 dark:bg-green-950"
              : "border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950",
          ].join(" ")}>
            <div className="flex items-center gap-2 mb-2.5">
              <div className={[
                "flex items-center justify-center size-6 rounded-full text-white",
                runResult.success ? "bg-green-500 dark:bg-green-600" : "bg-red-500 dark:bg-red-600",
              ].join(" ")}>
                {runResult.success ? (
                  <Check className="size-3.5 stroke-[3]" />
                ) : (
                  <AlertTriangle className="size-3.5" />
                )}
              </div>
              <span className={[
                "text-sm font-bold",
                runResult.success ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
              ].join(" ")}>
                {runResult.success ? "Run Complete" : "Run Failed"}
              </span>
            </div>
            <div className="space-y-0.5">
              <div className="flex justify-between text-xs py-0.5">
                <span className="text-muted-foreground">Records found</span>
                <span className="font-semibold">{runResult.recordsFound}</span>
              </div>
              <div className="flex justify-between text-xs py-0.5">
                <span className="text-muted-foreground">Records routed</span>
                <span className="font-semibold">{runResult.recordsRouted}</span>
              </div>
              <div className="flex justify-between text-xs py-0.5">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-semibold">{formatDurationMs(runResult.durationMs)}</span>
              </div>
              {runResult.error && (
                <div className="flex justify-between text-xs py-0.5">
                  <span className="text-muted-foreground">Error</span>
                  <span className="font-semibold text-red-600 dark:text-red-400 text-right max-w-[180px] truncate">
                    {runResult.error}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Run Again button */}
        {isComplete && (
          <Button
            type="button"
            onClick={() => {
              setIsComplete(false)
              hasStartedRef.current = false
              setTimeout(() => startRun(), 50)
            }}
            className="w-full gap-2 bg-teal-500 hover:bg-teal-600 dark:bg-teal-600 dark:hover:bg-teal-700 text-white"
          >
            <RotateCcw className="size-4" />
            Run Again
          </Button>
        )}

        {/* Divider */}
        {history.length > 0 && <div className="h-px bg-border" />}

        {/* Run History */}
        {history.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
              Run History
            </div>
            <div className="space-y-0">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 py-1.5 text-xs border-b border-gray-100 dark:border-gray-800 last:border-b-0"
                >
                  <span className="flex-shrink-0">
                    {entry.success ? (
                      <CheckCircle2 className="size-3.5 text-green-500 dark:text-green-400" />
                    ) : (
                      <AlertTriangle className="size-3.5 text-amber-500 dark:text-amber-400" />
                    )}
                  </span>
                  <span className="text-muted-foreground min-w-[100px]">{entry.date}</span>
                  <span className={["flex-1 font-medium", entry.recordsRouted === 0 ? "text-muted-foreground" : ""].join(" ")}>
                    {entry.recordsRouted} routed
                  </span>
                  <span className="text-muted-foreground font-mono text-[11px]">{entry.duration}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export type { RunningStep }
