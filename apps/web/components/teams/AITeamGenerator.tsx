"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Sparkles,
  X,
  Loader2,
  Mic,
  MicOff,
  RefreshCw,
  Check,
  AlertTriangle,
  Users,
  BrainCircuit,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AITeamGeneratorProps {
  onCreated: (teamId: string) => void
  onClose: () => void
}

type GeneratorState =
  | "idle"
  | "generating"
  | "preview"
  | "creating"
  | "error"

interface GeneratedMember {
  aiName: string
  matchedUserId: string | null
  matchedUserName: string | null
  matchedUserEmail: string | null
  weight: number
  confidence: "exact" | "fuzzy" | "unmatched"
}

interface GenerateTeamResult {
  team: {
    name: string
    description: string | null
    distributionType: "round-robin" | "weighted"
  }
  members: GeneratedMember[]
  weights: {
    mode: "percentage" | "points"
  } | null
  warnings: string[]
  confidence: number
}

// ---------------------------------------------------------------------------
// Inline Paywall
// ---------------------------------------------------------------------------

function InlinePaywall() {
  return (
    <div className="text-center py-6">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900 dark:to-purple-900">
        <BrainCircuit className="h-6 w-6 text-violet-600 dark:text-violet-400" />
      </div>
      <p className="text-sm font-medium mb-1.5">AI Team Generator</p>
      <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
        Describe your team in plain English and let AI build the full
        configuration with members, weights, and distribution type.
      </p>
      <a
        href="https://openedgeai.tech/pricing"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 dark:from-violet-500 dark:to-purple-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-500/40"
      >
        <BrainCircuit className="h-4 w-4" />
        Upgrade to Pro
      </a>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Confidence dot
// ---------------------------------------------------------------------------

function ConfidenceDot({ confidence }: { confidence: "exact" | "fuzzy" | "unmatched" }) {
  const colors = {
    exact: "bg-green-500",
    fuzzy: "bg-yellow-500",
    unmatched: "bg-red-500",
  }
  const labels = {
    exact: "Exact match",
    fuzzy: "Fuzzy match",
    unmatched: "No match",
  }
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full shrink-0 ${colors[confidence]}`}
      title={labels[confidence]}
    />
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AITeamGenerator({ onCreated, onClose }: AITeamGeneratorProps) {
  const [genState, setGenState] = useState<GeneratorState>("idle")
  const [description, setDescription] = useState("")
  const [result, setResult] = useState<GenerateTeamResult | null>(null)
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

  // License check
  const licenseQuery = useQuery({
    queryKey: ["license"],
    queryFn: async () => {
      const res = await fetch("/api/license")
      if (!res.ok) return { tier: "free" }
      return res.json()
    },
  })
  const isFreeTier = (licenseQuery.data?.tier ?? "free") === "free"

  // Escape key to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onClose])

  // Generate API call
  const handleGenerate = useCallback(async () => {
    if (!description.trim()) return
    setGenState("generating")
    setError("")
    try {
      const res = await fetch("/api/ai/generate-team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Generation failed" }))
        throw new Error(err.error || err.message || "Generation failed")
      }
      const data: GenerateTeamResult = await res.json()
      setResult(data)
      setGenState("preview")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed")
      setGenState("error")
    }
  }, [description])

  // Regenerate
  const handleRegenerate = useCallback(async () => {
    setGenState("generating")
    setError("")
    try {
      const res = await fetch("/api/ai/generate-team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Generation failed" }))
        throw new Error(err.error || err.message || "Generation failed")
      }
      const data: GenerateTeamResult = await res.json()
      setResult(data)
      setGenState("preview")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed")
      setGenState("error")
    }
  }, [description])

  // Create team workflow — 3 sequential API calls
  const handleCreate = useCallback(async () => {
    if (!result) return
    setGenState("creating")
    try {
      // Step 1: Create team
      const createRes = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: result.team.name,
          description: result.team.description || undefined,
          distributionType: result.team.distributionType,
        }),
      })
      const createData = await createRes.json()
      if (!createRes.ok) throw new Error(createData.error || "Failed to create team")
      const team = createData.team

      // Step 2: Add matched members
      const matchedUserIds = result.members
        .filter((m) => m.matchedUserId)
        .map((m) => m.matchedUserId as string)

      if (matchedUserIds.length > 0) {
        const membersRes = await fetch(`/api/teams/${team.id}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: matchedUserIds }),
        })
        if (!membersRes.ok) {
          const membersData = await membersRes.json()
          throw new Error(membersData.error || "Failed to add members")
        }
      }

      // Step 3: Set weights if weighted distribution
      if (result.team.distributionType === "weighted" && result.weights) {
        const weightMap: Record<string, number> = {}
        for (const m of result.members) {
          if (m.matchedUserId && m.weight) {
            weightMap[m.matchedUserId] = m.weight
          }
        }
        if (Object.keys(weightMap).length > 0) {
          const weightsRes = await fetch(`/api/teams/${team.id}/weights`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: result.weights.mode,
              weights: weightMap,
            }),
          })
          if (!weightsRes.ok) {
            const weightsData = await weightsRes.json()
            throw new Error(weightsData.error || "Failed to set weights")
          }
        }
      }

      onCreated(team.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team")
      setGenState("error")
    }
  }, [result, onCreated])

  const handleRetry = useCallback(() => {
    handleGenerate()
  }, [handleGenerate])

  // Count matched / unmatched members
  const matchedCount = result?.members.filter((m) => m.matchedUserId).length ?? 0
  const unmatchedCount = result?.members.filter((m) => !m.matchedUserId).length ?? 0

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
          className="pointer-events-auto w-full max-w-[640px] max-h-[85vh] overflow-y-auto rounded-2xl border border-violet-500/20 bg-white dark:bg-[#12121a] shadow-2xl shadow-violet-500/10"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-violet-500/20">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-base font-semibold">AI Team Generator</h3>
                <p className="text-sm text-muted-foreground">
                  Describe your team in plain English
                </p>
              </div>
              <Badge className="bg-violet-600 text-[10px] px-1.5 py-0 text-white border-0">
                PRO
              </Badge>
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
            {/* Paywall for free tier */}
            {isFreeTier ? (
              <InlinePaywall />
            ) : (
              <>
                {/* Idle state */}
                {genState === "idle" && (
                  <div className="space-y-3">
                    <div className="relative">
                      <Textarea
                        placeholder={
                          isListening
                            ? "Listening..."
                            : 'Describe your team... e.g., "Enterprise SDR team with Sarah, Mike, and James. Sarah should get 50% of leads, Mike 30%, and James 20%"'
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
                      Generate Team
                    </Button>
                  </div>
                )}

                {/* Generating state */}
                {genState === "generating" && (
                  <div className="flex flex-col items-center gap-3 py-10">
                    <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
                    <span className="text-sm text-muted-foreground">
                      Generating team...
                    </span>
                    <p className="text-xs text-muted-foreground/60 max-w-xs text-center">
                      Analyzing your description and matching members from your org
                    </p>
                  </div>
                )}

                {/* Preview state */}
                {genState === "preview" && result && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                      {/* Team name + distribution type */}
                      <div className="px-4 py-3 border-b border-border">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Generated Team
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-sm font-medium">
                            {result.team.name}
                          </p>
                          <Badge
                            className={`text-xs shrink-0 ${
                              result.team.distributionType === "weighted"
                                ? "bg-purple-100 text-purple-700 hover:bg-purple-100 dark:bg-purple-950 dark:text-purple-300 border-purple-200 dark:border-purple-800"
                                : "bg-green-50 text-green-700 hover:bg-green-50 dark:bg-green-950 dark:text-green-300 border-green-200 dark:border-green-800"
                            }`}
                          >
                            {result.team.distributionType === "weighted"
                              ? "Weighted"
                              : "Round Robin"}
                          </Badge>
                        </div>
                        {result.team.description && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {result.team.description}
                          </p>
                        )}
                      </div>

                      {/* Members */}
                      <div className="px-4 py-3 space-y-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/10 text-violet-500 shrink-0">
                            <Users className="h-3.5 w-3.5" />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">
                            Members ({result.members.length})
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          {result.members.map((member, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2.5 text-sm px-2 py-1.5 rounded-md bg-background/50"
                            >
                              <ConfidenceDot confidence={member.confidence} />
                              <span className="font-medium truncate">
                                {member.matchedUserName ?? member.aiName}
                              </span>
                              {member.matchedUserEmail && (
                                <span className="text-xs text-muted-foreground truncate">
                                  {member.matchedUserEmail}
                                </span>
                              )}
                              {result.team.distributionType === "weighted" &&
                                member.weight != null && (
                                  <Badge
                                    variant="secondary"
                                    className="ml-auto text-[10px] shrink-0"
                                  >
                                    {member.weight}%
                                  </Badge>
                                )}
                              {!member.matchedUserId && (
                                <span className="ml-auto text-[10px] text-red-400">
                                  Not found in org
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Warnings */}
                      {result.warnings.length > 0 && (
                        <div className="px-4 py-3 border-t border-border space-y-1.5">
                          {result.warnings.map((warning, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/20 px-3 py-2"
                            >
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
                              <span className="text-xs text-amber-700 dark:text-amber-300">
                                {warning}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Summary line */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{matchedCount} matched</span>
                      {unmatchedCount > 0 && (
                        <span className="text-amber-500">
                          {unmatchedCount} unmatched
                        </span>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleCreate}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white h-9"
                      >
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                        Create Team
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

                {/* Creating state */}
                {genState === "creating" && (
                  <div className="flex flex-col items-center gap-3 py-10">
                    <Loader2 className="h-6 w-6 text-green-400 animate-spin" />
                    <span className="text-sm text-muted-foreground">
                      Creating team...
                    </span>
                    <p className="text-xs text-muted-foreground/60 max-w-xs text-center">
                      Setting up team, adding members, and configuring distribution
                    </p>
                  </div>
                )}

                {/* Error state */}
                {genState === "error" && (
                  <div className="space-y-3">
                    <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 flex items-start gap-2.5">
                      <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-red-400">
                          {result ? "Creation Failed" : "Generation Failed"}
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
                        onClick={result ? handleCreate : handleRetry}
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
                          setResult(null)
                        }}
                      >
                        Start Over
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
