"use client"

import { useState, useCallback, useRef } from "react"
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  ArrowDown,
  Check,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Mic,
  MicOff,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import type { ConditionGroup, Condition } from "@/components/condition-builder/types"
import type { ObjectType, TriggerEvent } from "../types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AITriggerGeneratorProps {
  objectType: ObjectType
  existingConditions: ConditionGroup[]
  onApply: (trigger: {
    objectType: ObjectType
    triggerEvent: TriggerEvent
    triggerConditions: ConditionGroup[]
  }) => void
}

type GeneratorState =
  | "idle"
  | "enhancing"
  | "enhanced"
  | "generating"
  | "preview"
  | "applied"
  | "error"

interface GeneratedTrigger {
  objectType: ObjectType
  triggerEvent: TriggerEvent
  triggerConditions: ConditionGroup[]
  confidence: "high" | "medium" | "low"
  warnings: string[]
  enhancedPrompt: string
}

/** Map API response to component's internal format with proper IDs */
function mapApiResponse(data: any): GeneratedTrigger {
  const confidenceNum = data.confidence ?? 0.5
  const confidence: "high" | "medium" | "low" =
    confidenceNum >= 0.8 ? "high" : confidenceNum >= 0.5 ? "medium" : "low"

  // Add id/groupId to conditions for ConditionBuilder compatibility
  const triggerConditions: ConditionGroup[] = (data.trigger?.conditions ?? []).map(
    (group: any, gi: number) => {
      const groupId = crypto.randomUUID()
      return {
        id: groupId,
        conjunction: group.conjunction ?? "AND",
        conditions: (group.conditions ?? []).map((c: any): Condition => ({
          id: crypto.randomUUID(),
          groupId,
          fieldApiName: c.fieldApiName,
          fieldType: c.fieldType,
          operator: c.operator,
          value: c.value ?? "",
        })),
      } satisfies ConditionGroup
    }
  )

  return {
    objectType: data.trigger?.objectType ?? "LEAD",
    triggerEvent: data.trigger?.triggerEvent ?? "INSERT",
    triggerConditions,
    confidence,
    warnings: data.warnings ?? [],
    enhancedPrompt: data.enhanced?.prompt ?? "",
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const operatorLabel = (op: string) => {
  const labels: Record<string, string> = {
    equals: "equals",
    not_equals: "does not equal",
    contains: "contains",
    not_contains: "does not contain",
    starts_with: "starts with",
    gt: ">",
    lt: "<",
    gte: "\u2265",
    lte: "\u2264",
    is_blank: "is blank",
    is_not_blank: "is not blank",
    is_true: "is true",
    is_false: "is false",
    includes: "includes",
    excludes: "excludes",
    before: "is before",
    after: "is after",
    within_last: "within last",
  }
  return labels[op] ?? op
}

const objectLabel = (obj: ObjectType) => {
  switch (obj) {
    case "LEAD":
      return "Lead"
    case "CONTACT":
      return "Contact"
    case "ACCOUNT":
      return "Account"
  }
}

const eventLabel = (evt: TriggerEvent) => {
  switch (evt) {
    case "INSERT":
      return "On Create"
    case "UPDATE":
      return "On Update"
    case "BOTH":
      return "Any Change"
  }
}

const confidenceConfig = (level: "high" | "medium" | "low") => {
  switch (level) {
    case "high":
      return { color: "bg-green-500", text: "text-green-400", label: "High confidence" }
    case "medium":
      return { color: "bg-yellow-500", text: "text-yellow-400", label: "Medium confidence" }
    case "low":
      return { color: "bg-red-500", text: "text-red-400", label: "Low confidence" }
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AITriggerGenerator({ objectType, existingConditions, onApply }: AITriggerGeneratorProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [state, setState] = useState<GeneratorState>("idle")
  const [description, setDescription] = useState("")
  const [originalDescription, setOriginalDescription] = useState("")
  const [result, setResult] = useState<GeneratedTrigger | null>(null)
  const [error, setError] = useState("")

  // Voice input
  const [isListening, setIsListening] = useState(false)
  const recognitionRef = useRef<any>(null)

  const supportsVoice = typeof window !== "undefined" &&
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

  const generateTrigger = useCallback(
    async (desc: string) => {
      const res = await fetch("/api/ai/generate-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, objectType }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Generation failed" }))
        throw new Error(err.error || err.message || "Generation failed")
      }
      return res.json()
    },
    [objectType]
  )

  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return
    setOriginalDescription(description.trim())
    setState("enhancing")
    setError("")
    try {
      const data = await generateTrigger(description.trim())
      setResult(mapApiResponse(data))
      setState("enhanced")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed")
      setState("error")
    }
  }, [description, generateTrigger])

  const handleUseEnhanced = useCallback(() => {
    if (!result) return
    setState("preview")
  }, [result])

  const handleEdit = useCallback(() => {
    if (!result) return
    setDescription(result.enhancedPrompt)
    setState("idle")
  }, [result])

  const handleSkip = useCallback(() => {
    if (!result) return
    setState("preview")
  }, [result])

  const hasExisting = existingConditions.some((g) => (g.conditions ?? []).length > 0)

  const handleApply = useCallback(() => {
    if (!result) return
    onApply({
      objectType: result.objectType,
      triggerEvent: result.triggerEvent,
      triggerConditions: result.triggerConditions,
    })
    setState("applied")
  }, [result, onApply])

  const handleAddToExisting = useCallback(() => {
    if (!result) return
    // Merge new conditions INTO the first existing AND group if possible,
    // otherwise append as new groups
    const merged = [...existingConditions.map((g) => ({ ...g, conditions: [...(g.conditions ?? [])] }))]
    for (const newGroup of result.triggerConditions) {
      if (newGroup.conjunction === "AND" && merged.length > 0 && merged[0].conjunction === "AND") {
        // Append conditions into the first AND group
        merged[0].conditions.push(...(newGroup.conditions ?? []))
      } else {
        // Different conjunction — add as separate group
        merged.push(newGroup)
      }
    }
    onApply({
      objectType: result.objectType,
      triggerEvent: result.triggerEvent,
      triggerConditions: merged,
    })
    setState("applied")
  }, [result, existingConditions, onApply])

  const handleRegenerate = useCallback(async () => {
    setState("enhancing")
    setError("")
    try {
      const data = await generateTrigger(originalDescription)
      setResult(mapApiResponse(data))
      setState("enhanced")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed")
      setState("error")
    }
  }, [originalDescription, generateTrigger])

  const handleRetry = useCallback(() => {
    handleGenerate()
  }, [handleGenerate])

  // Applied state — success banner + ready for more input
  const appliedBanner = state === "applied" ? (
    <div className="rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <span className="text-xs text-green-400 font-medium">
          Applied! Add more conditions below.
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-6 px-2 text-xs text-muted-foreground"
        onClick={() => { setState("idle"); setDescription(""); }}
      >
        Dismiss
      </Button>
    </div>
  ) : null

  return (
    <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 overflow-hidden">
      {/* Header — toggle */}
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2.5 hover:bg-violet-500/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-medium text-violet-300">AI Generate</span>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Collapsible body */}
      {isOpen && (
        <div className="px-3 pb-3 space-y-3">
          <Separator className="bg-violet-500/20" />

          <>
              {/* Applied banner */}
              {appliedBanner}

              {/* Idle state — input (also shown after applied) */}
              {(state === "idle" || state === "applied") && (
                <div className="space-y-2">
                  <div className="relative">
                    <Textarea
                      placeholder={isListening ? "Listening..." : 'Describe your trigger... e.g., "All leads from web with company size > 100"'}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      rows={3}
                      className={`resize-none text-sm bg-background/50 border-violet-500/20 focus:border-violet-500/40 pr-10 ${isListening ? "border-red-500/50" : ""}`}
                    />
                    {supportsVoice && (
                      <button
                        type="button"
                        onClick={toggleVoice}
                        className={`absolute right-2 top-2 p-1.5 rounded-md transition-colors ${
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
                    onClick={() => { if (isListening) { recognitionRef.current?.stop(); setIsListening(false); } handleGenerate(); }}
                    disabled={!description.trim()}
                    className="w-full bg-violet-600 hover:bg-violet-700 text-white"
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    Generate
                  </Button>
                </div>
              )}

              {/* Enhancing state — spinner */}
              {state === "enhancing" && (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="h-4 w-4 text-violet-400 animate-spin" />
                  <span className="text-sm text-muted-foreground">
                    Improving your description...
                  </span>
                </div>
              )}

              {/* Enhanced state — show original vs enhanced */}
              {state === "enhanced" && result && (
                <div className="space-y-3">
                  {/* Original */}
                  <p className="text-xs text-muted-foreground line-through opacity-60">
                    {originalDescription}
                  </p>

                  <div className="flex justify-center">
                    <ArrowDown className="h-3.5 w-3.5 text-violet-400" />
                  </div>

                  {/* Enhanced prompt */}
                  <div className="rounded-md border border-violet-500/20 bg-violet-500/10 px-3 py-2">
                    <p className="text-sm text-violet-200">{result.enhancedPrompt}</p>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-violet-400">
                    <Sparkles className="h-3 w-3" />
                    AI improved your description
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleUseEnhanced} className="flex-1 bg-violet-600 hover:bg-violet-700 text-white">
                      Use This
                    </Button>
                    <Button size="sm" variant="outline" onClick={handleEdit} className="border-violet-500/30">
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleSkip}>
                      Skip
                    </Button>
                  </div>
                </div>
              )}

              {/* Generating state — spinner */}
              {state === "generating" && (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="h-4 w-4 text-violet-400 animate-spin" />
                  <span className="text-sm text-muted-foreground">
                    Generating trigger configuration...
                  </span>
                </div>
              )}

              {/* Preview state — show generated trigger */}
              {state === "preview" && result && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border bg-background/50 overflow-hidden">
                    {/* Preview header */}
                    <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Generated Trigger
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`h-2 w-2 rounded-full ${confidenceConfig(result.confidence).color}`}
                        />
                        <span className={`text-xs ${confidenceConfig(result.confidence).text}`}>
                          {confidenceConfig(result.confidence).label}
                        </span>
                      </div>
                    </div>

                    <div className="px-3 py-2.5 space-y-2.5">
                      {/* Object */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-14 shrink-0">Object</span>
                        <Badge variant="secondary" className="text-xs">
                          {objectLabel(result.objectType)}
                        </Badge>
                      </div>

                      {/* Event */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-14 shrink-0">Event</span>
                        <Badge variant="secondary" className="text-xs">
                          {eventLabel(result.triggerEvent)}
                        </Badge>
                      </div>

                      {/* Conditions */}
                      {(result.triggerConditions ?? []).length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          <span className="text-xs text-muted-foreground">Conditions</span>
                          {(result.triggerConditions ?? []).map((group, gi) => (
                            <div key={`grp-${gi}`} className="space-y-1">
                              {gi > 0 && (
                                <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wider">
                                  OR
                                </span>
                              )}
                              {(group.conditions ?? []).map((cond, ci) => (
                                <div key={`cond-${gi}-${ci}`} className="flex items-baseline gap-1.5 flex-wrap text-xs">
                                  {ci > 0 && (
                                    <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                                      {group.conjunction}
                                    </span>
                                  )}
                                  <span className="font-mono text-violet-400">
                                    {cond.fieldApiName}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {operatorLabel(cond.operator)}
                                  </span>
                                  {cond.value && (
                                    <span className="text-green-400 font-medium">
                                      &quot;{cond.value}&quot;
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Warnings */}
                      {result.warnings.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          {result.warnings.map((w, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-400"
                            >
                              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                              {w}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {hasExisting ? (
                      <>
                        <Button
                          size="sm"
                          onClick={handleAddToExisting}
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                        >
                          <Check className="h-3.5 w-3.5 mr-1.5" />
                          Add to Existing
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleApply}>
                          Replace All
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        onClick={handleApply}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                      >
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                        Apply to Trigger
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={handleRegenerate}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                      Regenerate
                    </Button>
                  </div>
                </div>
              )}

              {/* Error state */}
              {state === "error" && (
                <div className="space-y-2">
                  <div className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                    {error}
                  </div>
                  <Button size="sm" variant="outline" onClick={handleRetry}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                    Retry
                  </Button>
                </div>
              )}
            </>
        </div>
      )}
    </div>
  )
}
