"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import {
  Sparkles,
  X,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  Check,
  Zap,
  Search,
  GitBranch,
  User,
  ArrowDown,
  AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import type { RouteBuilderState } from "./types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AIRouteGeneratorProps {
  onApply: (state: RouteBuilderState) => void
  onClose: () => void
}

type GeneratorState =
  | "idle"
  | "generating"
  | "enhanced"
  | "preview"
  | "error"

interface RoutePreview {
  routeState: RouteBuilderState
  enhancedPrompt: string
  summary: {
    routeName: string
    triggerSummary: string
    matchSummary: string | null
    pathSummaries: { label: string; conditions: string; assignment: string }[]
    defaultOwnerSummary: string | null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSummary(routeState: RouteBuilderState): RoutePreview["summary"] {
  const trigger = routeState.trigger
  const objectLabel =
    trigger?.objectType === "LEAD"
      ? "Lead"
      : trigger?.objectType === "CONTACT"
        ? "Contact"
        : trigger?.objectType === "ACCOUNT"
          ? "Account"
          : "Lead"
  const eventLabel =
    trigger?.triggerEvent === "INSERT"
      ? "On Create"
      : trigger?.triggerEvent === "UPDATE"
        ? "On Update"
        : trigger?.triggerEvent === "BOTH"
          ? "Any Change"
          : "On Create"
  const condCount = trigger?.triggerConditions?.length ?? 0
  const triggerSummary = `${objectLabel} / ${eventLabel}${condCount > 0 ? ` / ${condCount} condition group${condCount > 1 ? "s" : ""}` : ""}`

  let matchSummary: string | null = null
  if (routeState.matchConfig) {
    const mc = routeState.matchConfig
    const fields: string[] = []
    if (mc.matchEmail) fields.push("email")
    if (mc.matchPhone) fields.push("phone")
    if (mc.matchDomain) fields.push("domain")
    if (mc.matchCompanyName) fields.push("company name")
    const modeLabel =
      mc.fuzzyMatchMode === "STRICT"
        ? "strict"
        : mc.fuzzyMatchMode === "FUZZY"
          ? "fuzzy"
          : "AI smart"
    matchSummary = `By ${fields.join(", ")} (${modeLabel})`
  }

  const pathSummaries = routeState.paths.map((p) => {
    const condGroupCount = p.conditions?.length ?? 0
    const conditions =
      condGroupCount > 0
        ? `${condGroupCount} condition group${condGroupCount > 1 ? "s" : ""}`
        : "No conditions"
    const assignType = p.action?.assignmentType
    const assignment = assignType
      ? `${assignType === "ROUND_ROBIN" ? "Round Robin" : assignType === "QUEUE" ? "Queue" : "User"}${p.action?.assigneeName ? ` - ${p.action.assigneeName}` : ""}`
      : "Unassigned"
    return { label: p.label, conditions, assignment }
  })

  let defaultOwnerSummary: string | null = null
  if (routeState.defaultOwner) {
    const d = routeState.defaultOwner
    defaultOwnerSummary = `${d.assignmentType === "ROUND_ROBIN" ? "Round Robin" : d.assignmentType === "QUEUE" ? "Queue" : "User"}${d.assigneeName ? ` - ${d.assigneeName}` : ""}`
  }

  return {
    routeName: routeState.name,
    triggerSummary,
    matchSummary,
    pathSummaries,
    defaultOwnerSummary,
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIRouteGenerator({ onApply, onClose }: AIRouteGeneratorProps) {
  const [genState, setGenState] = useState<GeneratorState>("idle")
  const [description, setDescription] = useState("")
  const [originalDescription, setOriginalDescription] = useState("")
  const [result, setResult] = useState<RoutePreview | null>(null)
  const [error, setError] = useState("")

  // Voice input
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<any>(null)

  const supportsVoice =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)

  const toggleVoice = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      return
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = "en-US"

    recognition.onresult = (event: any) => {
      let transcript = ""
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      setDescription(transcript)
    }

    recognition.onerror = () => {
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [isListening])

  // Escape key to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  // API call
  const generateRoute = useCallback(async (desc: string) => {
    const res = await fetch("/api/ai/generate-route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: desc }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Generation failed" }))
      throw new Error(err.error || err.message || "Generation failed")
    }
    return res.json()
  }, [])

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return
    setOriginalDescription(description.trim())
    setGenState("generating")
    setError("")
    try {
      const data = await generateRoute(description.trim())
      const routeState: RouteBuilderState = data.routeState
      const enhancedPrompt: string = data.enhancedPrompt ?? ""
      setResult({
        routeState,
        enhancedPrompt,
        summary: buildSummary(routeState),
      })
      setGenState(enhancedPrompt ? "enhanced" : "preview")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed")
      setGenState("error")
    }
  }, [description, generateRoute])

  const handleUseEnhanced = useCallback(() => {
    setGenState("preview")
  }, [])

  const handleEditEnhanced = useCallback(() => {
    if (!result) return
    setDescription(result.enhancedPrompt)
    setGenState("idle")
  }, [result])

  const handleSkipEnhanced = useCallback(() => {
    setGenState("preview")
  }, [])

  const handleApply = useCallback(() => {
    if (!result) return
    onApply(result.routeState)
  }, [result, onApply])

  const handleRegenerate = useCallback(async () => {
    setGenState("generating")
    setError("")
    try {
      const data = await generateRoute(originalDescription)
      const routeState: RouteBuilderState = data.routeState
      const enhancedPrompt: string = data.enhancedPrompt ?? ""
      setResult({
        routeState,
        enhancedPrompt,
        summary: buildSummary(routeState),
      })
      setGenState(enhancedPrompt ? "enhanced" : "preview")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed")
      setGenState("error")
    }
  }, [originalDescription, generateRoute])

  const handleRetry = useCallback(() => {
    handleGenerate()
  }, [handleGenerate])

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Floating panel */}
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-[720px] max-h-[85vh] overflow-y-auto rounded-2xl border border-violet-500/20 bg-white dark:bg-[#12121a] shadow-2xl shadow-violet-500/10"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-violet-500/20">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-base font-semibold">AI Route Generator</h3>
                <p className="text-sm text-muted-foreground">
                  Describe your routing workflow in plain English
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            <>
                {/* Idle state */}
                {genState === "idle" && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Textarea
                        placeholder={
                          isListening
                            ? "Listening..."
                            : 'Describe your entire route... e.g., "All web leads, match by email, assign enterprise leads to the enterprise team via round-robin, everything else to the general queue"'
                        }
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={5}
                        className={`resize-none text-sm bg-background/50 border-violet-500/20 focus:border-violet-500/40 pr-10 min-h-[120px] ${isListening ? "border-red-500/50" : ""}`}
                        autoFocus
                      />
                      {supportsVoice && (
                        <button
                          type="button"
                          onClick={toggleVoice}
                          className={`absolute right-2.5 top-2.5 p-1.5 rounded-md transition-colors ${
                            isListening
                              ? "bg-red-500/20 text-red-400 animate-pulse"
                              : "text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10"
                          }`}
                          title={isListening ? "Stop listening" : "Voice input"}
                        >
                          {isListening ? (
                            <MicOff className="h-4 w-4" />
                          ) : (
                            <Mic className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        if (isListening) {
                          recognitionRef.current?.stop()
                          setIsListening(false)
                        }
                        handleGenerate()
                      }}
                      disabled={!description.trim()}
                      className="w-full bg-violet-600 hover:bg-violet-700 text-white h-9"
                    >
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                      Generate Route
                    </Button>
                  </div>
                )}

                {/* Generating state */}
                {genState === "generating" && (
                  <div className="flex flex-col items-center gap-3 py-10">
                    <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
                    <span className="text-sm text-muted-foreground">
                      Generating your route...
                    </span>
                    <p className="text-xs text-muted-foreground/60 max-w-xs text-center">
                      Analyzing your description and building trigger, match, paths, and assignments
                    </p>
                  </div>
                )}

                {/* Enhanced state */}
                {genState === "enhanced" && result && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground line-through opacity-60">
                      {originalDescription}
                    </p>

                    <div className="flex justify-center">
                      <ArrowDown className="h-3.5 w-3.5 text-violet-400" />
                    </div>

                    <div className="rounded-md border border-violet-500/20 bg-violet-500/10 px-3 py-2.5">
                      <p className="text-sm text-violet-700 dark:text-violet-200">
                        {result.enhancedPrompt}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-violet-400">
                      <Sparkles className="h-3 w-3" />
                      AI improved your description
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleUseEnhanced}
                        className="flex-1 bg-violet-600 hover:bg-violet-700 text-white"
                      >
                        Use This
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleEditEnhanced}
                        className="border-violet-500/30"
                      >
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={handleSkipEnhanced}>
                        Skip
                      </Button>
                    </div>
                  </div>
                )}

                {/* Preview state */}
                {genState === "preview" && result && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                      {/* Route name */}
                      <div className="px-4 py-3 border-b border-border">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Generated Route
                          </span>
                        </div>
                        <p className="text-sm font-medium mt-1">
                          {result.summary.routeName}
                        </p>
                      </div>

                      <div className="px-4 py-3 space-y-3">
                        {/* Trigger */}
                        <div className="flex items-start gap-2.5">
                          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-500 shrink-0 mt-0.5">
                            <Zap className="h-3.5 w-3.5" />
                          </div>
                          <div>
                            <span className="text-xs font-medium text-muted-foreground">
                              Trigger
                            </span>
                            <p className="text-sm">
                              {result.summary.triggerSummary}
                            </p>
                          </div>
                        </div>

                        {/* Match */}
                        {result.summary.matchSummary && (
                          <div className="flex items-start gap-2.5">
                            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-500/10 text-blue-500 shrink-0 mt-0.5">
                              <Search className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <span className="text-xs font-medium text-muted-foreground">
                                Match
                              </span>
                              <p className="text-sm">
                                {result.summary.matchSummary}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Paths */}
                        {result.summary.pathSummaries.length > 0 && (
                          <div className="flex items-start gap-2.5">
                            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10 text-violet-500 shrink-0 mt-0.5">
                              <GitBranch className="h-3.5 w-3.5" />
                            </div>
                            <div className="flex-1">
                              <span className="text-xs font-medium text-muted-foreground">
                                Paths ({result.summary.pathSummaries.length})
                              </span>
                              <div className="space-y-1.5 mt-1">
                                {result.summary.pathSummaries.map((p, i) => (
                                  <div
                                    key={i}
                                    className="flex items-center gap-2 text-sm"
                                  >
                                    <Badge
                                      variant="secondary"
                                      className="text-[10px] shrink-0"
                                    >
                                      {p.label}
                                    </Badge>
                                    <span className="text-muted-foreground text-xs">
                                      {p.conditions}
                                    </span>
                                    <span className="text-xs">
                                      {p.assignment}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Default owner */}
                        {result.summary.defaultOwnerSummary && (
                          <div className="flex items-start gap-2.5">
                            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-green-500/10 text-green-500 shrink-0 mt-0.5">
                              <User className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <span className="text-xs font-medium text-muted-foreground">
                                Default Owner
                              </span>
                              <p className="text-sm">
                                {result.summary.defaultOwnerSummary}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleApply}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white h-9"
                      >
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                        Create Route Workflow
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRegenerate}
                        className="border-violet-500/30"
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        Regenerate
                      </Button>
                    </div>
                  </div>
                )}

                {/* Error state */}
                {genState === "error" && (
                  <div className="space-y-3">
                    <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 flex items-start gap-2.5">
                      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-red-400">
                          Generation Failed
                        </p>
                        <p className="text-xs text-red-400/80 mt-0.5">
                          {error}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleRetry}
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        Retry
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setGenState("idle")
                          setError("")
                        }}
                      >
                        Start Over
                      </Button>
                    </div>
                  </div>
                )}
              </>
          </div>
        </div>
      </div>
    </>
  )
}
