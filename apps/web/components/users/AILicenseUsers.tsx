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
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AILicenseUsersProps {
  onComplete: (licensedCount: number) => void
  onClose: () => void
}

type GeneratorState =
  | "idle"
  | "generating"
  | "preview"
  | "licensing"
  | "error"

interface ResolvedUser {
  aiName: string
  matchedUserId: string | null
  matchedUserName: string | null
  matchedUserEmail: string | null
  isAlreadyLicensed: boolean
  confidence: "exact" | "fuzzy" | "unmatched"
}

interface LicenseResult {
  strategy: string
  users: ResolvedUser[]
  warnings: string[]
  confidence: number
  newToLicense: number
  alreadyLicensed: number
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
      <p className="text-sm font-medium mb-1.5">AI License Manager</p>
      <p className="text-xs text-muted-foreground mb-4 max-w-sm mx-auto">
        Describe who to license in plain English and let AI resolve
        users from your org and license them in bulk.
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
// Confidence dot (extended with gray for already-licensed)
// ---------------------------------------------------------------------------

function ConfidenceDot({
  confidence,
  alreadyLicensed,
}: {
  confidence: "exact" | "fuzzy" | "unmatched"
  alreadyLicensed?: boolean
}) {
  if (alreadyLicensed) {
    return (
      <span
        className="inline-block h-2 w-2 rounded-full shrink-0 bg-gray-400"
        title="Already licensed"
      />
    )
  }

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
// Strategy badge helper
// ---------------------------------------------------------------------------

function StrategyBadge({ strategy }: { strategy: string }) {
  const label = strategy
    .replace(/^all[-_]?users$/i, "All Users")
    .replace(/^by[-_]?name$/i, "By Name")
    .replace(/^by[-_]?role:?\s*/i, "By Role: ")
    .replace(/^by[-_]?department:?\s*/i, "By Department: ")

  return (
    <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 dark:bg-violet-950 dark:text-violet-300 border-violet-200 dark:border-violet-800 text-xs shrink-0">
      {label}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AILicenseUsers({ onComplete, onClose }: AILicenseUsersProps) {
  const [genState, setGenState] = useState<GeneratorState>("idle")
  const [description, setDescription] = useState("")
  const [result, setResult] = useState<LicenseResult | null>(null)
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
      const res = await fetch("/api/ai/license-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Generation failed" }))
        throw new Error(err.error || err.message || "Generation failed")
      }
      const data: LicenseResult = await res.json()
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
      const res = await fetch("/api/ai/license-users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Generation failed" }))
        throw new Error(err.error || err.message || "Generation failed")
      }
      const data: LicenseResult = await res.json()
      setResult(data)
      setGenState("preview")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Generation failed")
      setGenState("error")
    }
  }, [description])

  // License users
  const handleLicense = useCallback(async () => {
    if (!result) return

    const userIds = result.users
      .filter((u) => u.matchedUserId && !u.isAlreadyLicensed)
      .map((u) => u.matchedUserId as string)

    if (userIds.length === 0) {
      setError("No new users to license")
      setGenState("error")
      return
    }

    setGenState("licensing")
    try {
      const res = await fetch("/api/users/bulk-license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds, action: "license" }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to license users" }))
        throw new Error(data.error || "Failed to license users")
      }

      onComplete(userIds.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to license users")
      setGenState("error")
    }
  }, [result, onComplete])

  const handleRetry = useCallback(() => {
    handleGenerate()
  }, [handleGenerate])

  // Derived counts
  const usersToLicense =
    result?.users.filter((u) => u.matchedUserId && !u.isAlreadyLicensed) ?? []
  const alreadyLicensed =
    result?.users.filter((u) => u.isAlreadyLicensed) ?? []
  const unmatched =
    result?.users.filter((u) => !u.matchedUserId) ?? []

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
                <h3 className="text-base font-semibold">AI License Manager</h3>
                <p className="text-sm text-muted-foreground">
                  Describe who to license in plain English
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
                            : 'Describe who to license... e.g., "License all users with the Sales Rep role" or "License John, Sarah, and Mike"'
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
                      Generate
                    </Button>
                  </div>
                )}

                {/* Generating state */}
                {genState === "generating" && (
                  <div className="flex flex-col items-center gap-3 py-10">
                    <Loader2 className="h-6 w-6 text-violet-400 animate-spin" />
                    <span className="text-sm text-muted-foreground">
                      Analyzing your request...
                    </span>
                    <p className="text-xs text-muted-foreground/60 max-w-xs text-center">
                      Resolving users from your org and checking license status
                    </p>
                  </div>
                )}

                {/* Preview state */}
                {genState === "preview" && result && (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                      {/* Strategy header */}
                      <div className="px-4 py-3 border-b border-border">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            License Strategy
                          </span>
                          <StrategyBadge strategy={result.strategy} />
                        </div>
                      </div>

                      {/* Users to License */}
                      {usersToLicense.length > 0 && (
                        <div className="px-4 py-3 space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-green-500/10 text-green-500 shrink-0">
                              <Users className="h-3.5 w-3.5" />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">
                              Users to License ({usersToLicense.length})
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            {usersToLicense.map((user, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2.5 text-sm px-2 py-1.5 rounded-md bg-background/50"
                              >
                                <ConfidenceDot confidence={user.confidence} />
                                <span className="font-medium truncate">
                                  {user.matchedUserName ?? user.aiName}
                                </span>
                                {user.matchedUserEmail && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    {user.matchedUserEmail}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Already Licensed */}
                      {alreadyLicensed.length > 0 && (
                        <div className="px-4 py-3 border-t border-border space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-gray-500/10 text-gray-400 shrink-0">
                              <ShieldCheck className="h-3.5 w-3.5" />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">
                              Already Licensed ({alreadyLicensed.length})
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            {alreadyLicensed.map((user, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2.5 text-sm px-2 py-1.5 rounded-md bg-background/50 opacity-60"
                              >
                                <ConfidenceDot
                                  confidence={user.confidence}
                                  alreadyLicensed
                                />
                                <span className="font-medium truncate">
                                  {user.matchedUserName ?? user.aiName}
                                </span>
                                {user.matchedUserEmail && (
                                  <span className="text-xs text-muted-foreground truncate">
                                    {user.matchedUserEmail}
                                  </span>
                                )}
                                <span className="ml-auto text-[10px] text-gray-400 shrink-0">
                                  Already licensed
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Unmatched */}
                      {unmatched.length > 0 && (
                        <div className="px-4 py-3 border-t border-border space-y-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-red-500/10 text-red-400 shrink-0">
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground">
                              Unmatched ({unmatched.length})
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            {unmatched.map((user, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2.5 text-sm px-2 py-1.5 rounded-md bg-background/50 opacity-60"
                              >
                                <ConfidenceDot confidence={user.confidence} />
                                <span className="font-medium truncate">
                                  {user.aiName}
                                </span>
                                <span className="ml-auto text-[10px] text-red-400 shrink-0">
                                  Not found in org
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

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
                      <span>
                        {usersToLicense.length} new
                        {alreadyLicensed.length > 0 &&
                          ` + ${alreadyLicensed.length} already licensed`}
                      </span>
                      {unmatched.length > 0 && (
                        <span className="text-amber-500">
                          {unmatched.length} unmatched
                        </span>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleLicense}
                        disabled={usersToLicense.length === 0}
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white h-9"
                      >
                        <Check className="h-3.5 w-3.5 mr-1.5" />
                        License {usersToLicense.length} User
                        {usersToLicense.length !== 1 ? "s" : ""}
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

                {/* Licensing state */}
                {genState === "licensing" && (
                  <div className="flex flex-col items-center gap-3 py-10">
                    <Loader2 className="h-6 w-6 text-green-400 animate-spin" />
                    <span className="text-sm text-muted-foreground">
                      Licensing users...
                    </span>
                    <p className="text-xs text-muted-foreground/60 max-w-xs text-center">
                      Applying licenses to {usersToLicense.length} user
                      {usersToLicense.length !== 1 ? "s" : ""}
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
                          {result ? "Licensing Failed" : "Generation Failed"}
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
                        onClick={result ? handleLicense : handleRetry}
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
