"use client"

import { useState, useCallback } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Search,
  Download,
  Sparkles,
  ExternalLink,
  Loader2,
  XCircle,
  FileCode2,
  GitBranch,
  ArrowRightLeft,
  Shield,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const STEPS = [
  { label: "Detect", description: "Scan for LeanData", icon: Search },
  { label: "Analyze", description: "Map configuration", icon: GitBranch },
  { label: "Preview", description: "Review conversion", icon: FileCode2 },
  { label: "Import", description: "Save to Flow Builder", icon: Download },
] as const

const MOCK_LEANDATA_FLOWS = [
  { name: "Lead Router", nodeCount: 12, edgeCount: 14, objectType: "LEAD" },
  { name: "Contact Router", nodeCount: 8, edgeCount: 10, objectType: "CONTACT" },
]

const MOCK_NODE_MAPPING = [
  { leandata: "Router (Branch Decision)", ours: "BRANCH_DECISION", supported: true },
  { leandata: "True-False Decision", ours: "DECISION", supported: true },
  { leandata: "Check Duplicates", ours: "MATCH", supported: true },
  { leandata: "Assign Owner", ours: "ASSIGNMENT", supported: true },
  { leandata: "Update Record", ours: "UPDATE_FIELD", supported: true },
  { leandata: "Create Task", ours: "CREATE_TASK", supported: true },
  { leandata: "Round Robin Pool", ours: "ASSIGNMENT (Round Robin)", supported: true },
  { leandata: "Outreach Integration", ours: "N/A", supported: false },
  { leandata: "Salesloft Integration", ours: "N/A", supported: false },
  { leandata: "Slack Notification", ours: "N/A", supported: false },
]

const MOCK_CONVERTED_NODES = [
  { id: 1, type: "TRIGGER", label: "New Lead Created", x: 0 },
  { id: 2, type: "DECISION", label: "Region = EMEA?", x: 1 },
  { id: 3, type: "MATCH", label: "Check Account Match", x: 2 },
  { id: 4, type: "ASSIGNMENT", label: "Assign to EMEA Team", x: 2 },
  { id: 5, type: "ASSIGNMENT", label: "Round Robin - US Team", x: 3 },
  { id: 6, type: "UPDATE_FIELD", label: "Set Status = Working", x: 3 },
]

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface FieldResult {
  fieldApiName: string
  fieldLabel: string
  fieldType: string
}

type DetectionResult = {
  status: "detected" | "not_found" | "error"
  leandataFields: FieldResult[]
  ldrFields: FieldResult[]
}

/* -------------------------------------------------------------------------- */
/*  Step Indicator                                                             */
/* -------------------------------------------------------------------------- */

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center justify-center gap-0">
      {STEPS.map((step, i) => {
        const isActive = i === currentStep
        const isComplete = i < currentStep
        const Icon = step.icon

        return (
          <div key={step.label} className="flex items-center">
            {/* Step circle + label */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300",
                  isComplete && "border-emerald-500 bg-emerald-500 dark:border-emerald-400 dark:bg-emerald-400",
                  isActive && "border-primary bg-primary/10 dark:bg-primary/20 ring-4 ring-primary/20",
                  !isActive && !isComplete && "border-muted-foreground/30 bg-transparent"
                )}
              >
                {isComplete ? (
                  <CheckCircle2 className="h-5 w-5 text-white dark:text-emerald-950" />
                ) : (
                  <Icon
                    className={cn(
                      "h-4.5 w-4.5 transition-colors",
                      isActive ? "text-primary" : "text-muted-foreground/50"
                    )}
                  />
                )}
                {isActive && (
                  <span className="absolute -inset-1 rounded-full animate-ping bg-primary/20 pointer-events-none" />
                )}
              </div>
              <div className="text-center min-w-[80px]">
                <p
                  className={cn(
                    "text-xs font-semibold transition-colors",
                    isActive ? "text-foreground" : isComplete ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/60"
                  )}
                >
                  {step.label}
                </p>
                <p
                  className={cn(
                    "text-[10px] transition-colors",
                    isActive ? "text-muted-foreground" : "text-muted-foreground/40"
                  )}
                >
                  {step.description}
                </p>
              </div>
            </div>

            {/* Connector line */}
            {i < STEPS.length - 1 && (
              <div
                className={cn(
                  "h-0.5 w-16 mx-2 mb-8 transition-colors duration-300",
                  i < currentStep
                    ? "bg-emerald-500 dark:bg-emerald-400"
                    : "bg-muted-foreground/20"
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Step 1: Detect LeanData                                                    */
/* -------------------------------------------------------------------------- */

function DetectStep({
  onComplete,
}: {
  onComplete: (result: DetectionResult) => void
}) {
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<DetectionResult | null>(null)

  const { data: leadFields, refetch: fetchLeadFields } = useQuery<{
    fields: FieldResult[]
  }>({
    queryKey: ["fields", "LEAD"],
    queryFn: () => fetch("/api/fields?object=LEAD").then((r) => r.json()),
    enabled: false,
  })

  const { refetch: fetchContactFields } = useQuery<{
    fields: FieldResult[]
  }>({
    queryKey: ["fields", "CONTACT"],
    queryFn: () => fetch("/api/fields?object=CONTACT").then((r) => r.json()),
    enabled: false,
  })

  const startScan = useCallback(async () => {
    setScanning(true)
    setResult(null)

    try {
      const [leadRes, contactRes] = await Promise.all([
        fetchLeadFields(),
        fetchContactFields(),
      ])

      const allFields = [
        ...(leadRes.data?.fields ?? []),
        ...(contactRes.data?.fields ?? []),
      ]

      const leandataFields = allFields.filter(
        (f) =>
          f.fieldApiName.startsWith("LeanData__") ||
          f.fieldApiName.includes("LeanData")
      )
      const ldrFields = allFields.filter(
        (f) =>
          f.fieldApiName.startsWith("LDR__") ||
          f.fieldApiName.includes("LDR__")
      )

      const detected = leandataFields.length > 0 || ldrFields.length > 0

      const res: DetectionResult = {
        status: detected ? "detected" : "not_found",
        leandataFields,
        ldrFields,
      }
      setResult(res)
    } catch {
      setResult({ status: "error", leandataFields: [], ldrFields: [] })
    } finally {
      setScanning(false)
    }
  }, [fetchLeadFields, fetchContactFields])

  return (
    <div className="space-y-6">
      {/* Hero section */}
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-blue-500/20 border border-violet-500/30">
          <ArrowRightLeft className="h-8 w-8 text-violet-400" />
        </div>
        <h2 className="text-xl font-semibold">Detect LeanData Installation</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          We will scan your Salesforce org for LeanData custom objects, fields,
          and routing configuration.
        </p>
      </div>

      {/* Scan button */}
      {!result && (
        <div className="flex justify-center">
          <Button
            size="lg"
            onClick={startScan}
            disabled={scanning}
            className="gap-2 px-8"
          >
            {scanning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Scanning Salesforce org...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Start Scan
              </>
            )}
          </Button>
        </div>
      )}

      {/* Scanning animation */}
      {scanning && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">Querying Salesforce describe API...</span>
          </div>
          <div className="space-y-2">
            {["Lead fields", "Contact fields", "Custom objects (LeanData__*)", "Custom objects (LDR__*)"].map(
              (item, i) => (
                <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      i < 2 ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/30"
                    )}
                  />
                  {item}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {result && result.status === "detected" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-300">LeanData installation detected</p>
              <p className="text-sm text-emerald-400/80 mt-0.5">
                Found {result.leandataFields.length + result.ldrFields.length} LeanData-related
                field{result.leandataFields.length + result.ldrFields.length !== 1 ? "s" : ""} across
                Lead and Contact objects.
              </p>
            </div>
          </div>

          {/* Field list */}
          {(result.leandataFields.length > 0 || result.ldrFields.length > 0) && (
            <div className="rounded-xl border border-border bg-card">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold">Detected Fields</h3>
              </div>
              <div className="divide-y divide-border max-h-60 overflow-y-auto">
                {[...result.leandataFields, ...result.ldrFields].map((f) => (
                  <div key={f.fieldApiName} className="px-4 py-2.5 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-mono">{f.fieldApiName}</span>
                      <span className="text-xs text-muted-foreground ml-2">{f.fieldLabel}</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {f.fieldType}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={() => onComplete(result)} className="gap-2">
              Continue to Analysis
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {result && result.status === "not_found" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-5 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-amber-300">No LeanData installation detected</p>
              <p className="text-sm text-amber-400/80 mt-0.5">
                We did not find any fields with <code className="bg-amber-950/50 px-1 py-0.5 rounded text-[11px]">LeanData__</code> or{" "}
                <code className="bg-amber-950/50 px-1 py-0.5 rounded text-[11px]">LDR__</code> prefixes.
                This does not necessarily mean LeanData is not installed &mdash; your fields may have been synced
                yet. Try syncing fields first in Settings.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="outline" asChild>
              <Link href="/integrations/salesforce">
                Sync Fields
                <ExternalLink className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button onClick={() => onComplete(result)} variant="secondary" className="gap-2">
              Continue with Demo Data
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {result && result.status === "error" && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-5 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-red-300">Scan failed</p>
            <p className="text-sm text-red-400/80 mt-0.5">
              Could not query Salesforce. Make sure your Salesforce org is connected and fields
              have been synced.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={startScan}>
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Step 2: Analyze Configuration                                              */
/* -------------------------------------------------------------------------- */

function AnalyzeStep({ onComplete }: { onComplete: () => void }) {
  const [analyzing, setAnalyzing] = useState(false)
  const [done, setDone] = useState(false)

  const startAnalysis = useCallback(() => {
    setAnalyzing(true)
    // Simulate analysis with mock data
    setTimeout(() => {
      setAnalyzing(false)
      setDone(true)
    }, 2500)
  }, [])

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30">
          <GitBranch className="h-8 w-8 text-blue-400" />
        </div>
        <h2 className="text-xl font-semibold">Analyze LeanData Configuration</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          We will read your LeanData routing flows and map each node type to our
          equivalent.
        </p>
      </div>

      {!done && !analyzing && (
        <div className="flex justify-center">
          <Button size="lg" onClick={startAnalysis} className="gap-2 px-8">
            <Sparkles className="h-4 w-4" />
            Analyze Flows
          </Button>
        </div>
      )}

      {analyzing && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">Analyzing LeanData routing graphs...</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full animate-pulse w-2/3" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {["Reading flow definitions...", "Mapping node types...", "Resolving dependencies...", "Building conversion plan..."].map(
              (item, i) => (
                <div key={item} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className={cn("h-3 w-3", i < 2 ? "animate-spin text-primary" : "text-muted-foreground/30")} />
                  {item}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {done && (
        <div className="space-y-5">
          {/* Summary banner */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5 flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-300">Analysis complete</p>
              <p className="text-sm text-emerald-400/80 mt-0.5">
                Found {MOCK_LEANDATA_FLOWS.length} LeanData routing flows with{" "}
                {MOCK_LEANDATA_FLOWS.reduce((acc, f) => acc + f.nodeCount, 0)} total nodes.
              </p>
            </div>
          </div>

          {/* Discovered flows */}
          <div className="grid gap-3 sm:grid-cols-2">
            {MOCK_LEANDATA_FLOWS.map((flow) => (
              <div
                key={flow.name}
                className="rounded-xl border border-border bg-card p-5 space-y-3 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">{flow.name}</h3>
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
                    {flow.objectType}
                  </Badge>
                </div>
                <div className="flex gap-6 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                    {flow.nodeCount} nodes
                  </span>
                  <span className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                    {flow.edgeCount} edges
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Node mapping table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold">Node Type Mapping</h3>
              <div className="flex gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                  {MOCK_NODE_MAPPING.filter((n) => n.supported).length} supported
                </span>
                <span className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-amber-400" />
                  {MOCK_NODE_MAPPING.filter((n) => !n.supported).length} unsupported
                </span>
              </div>
            </div>

            <div className="divide-y divide-border">
              {/* Header */}
              <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-4 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50">
                <span>LeanData Node</span>
                <span />
                <span>Our Equivalent</span>
                <span>Status</span>
              </div>

              {MOCK_NODE_MAPPING.map((mapping) => (
                <div
                  key={mapping.leandata}
                  className={cn(
                    "grid grid-cols-[1fr_auto_1fr_auto] gap-4 px-4 py-2.5 items-center text-sm",
                    !mapping.supported && "opacity-60"
                  )}
                >
                  <span className="font-mono text-xs">{mapping.leandata}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className={cn("font-mono text-xs", mapping.supported ? "text-emerald-400" : "text-muted-foreground")}>
                    {mapping.ours}
                  </span>
                  {mapping.supported ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-400" />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={onComplete} className="gap-2">
              Preview Conversion
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Step 3: Preview Conversion                                                 */
/* -------------------------------------------------------------------------- */

function PreviewStep({ onComplete }: { onComplete: () => void }) {
  const supportedCount = MOCK_NODE_MAPPING.filter((n) => n.supported).length
  const unsupportedCount = MOCK_NODE_MAPPING.filter((n) => !n.supported).length
  const conversionRate = Math.round((supportedCount / MOCK_NODE_MAPPING.length) * 100)

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30">
          <FileCode2 className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-xl font-semibold">Preview Converted Flow</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Review how your LeanData routing will look in our Flow Builder before importing.
        </p>
      </div>

      {/* Conversion stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">{conversionRate}%</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Conversion Rate</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold">{supportedCount}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Nodes Converted</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 text-center">
          <p className="text-2xl font-bold text-amber-400">{unsupportedCount}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Skipped</p>
        </div>
      </div>

      {/* Flow preview (mock visual) */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold">Lead Router &mdash; Converted Flow</h3>
          <Badge variant="secondary" className="text-[10px]">
            Read-only Preview
          </Badge>
        </div>

        <div className="p-6 bg-[#0a0a12] min-h-[280px] relative overflow-x-auto">
          {/* Simplified flow visualization */}
          <div className="flex items-start gap-3 min-w-[700px]">
            {MOCK_CONVERTED_NODES.map((node, i) => {
              const colors: Record<string, { bg: string; border: string; text: string }> = {
                TRIGGER: { bg: "bg-violet-950/60", border: "border-violet-500/40", text: "text-violet-300" },
                DECISION: { bg: "bg-blue-950/60", border: "border-blue-500/40", text: "text-blue-300" },
                MATCH: { bg: "bg-cyan-950/60", border: "border-cyan-500/40", text: "text-cyan-300" },
                ASSIGNMENT: { bg: "bg-emerald-950/60", border: "border-emerald-500/40", text: "text-emerald-300" },
                UPDATE_FIELD: { bg: "bg-amber-950/60", border: "border-amber-500/40", text: "text-amber-300" },
              }
              const c = colors[node.type] ?? colors.TRIGGER

              return (
                <div key={node.id} className="flex items-center">
                  <div
                    className={cn(
                      "rounded-lg border px-4 py-3 min-w-[110px] text-center shadow-lg",
                      c.bg,
                      c.border
                    )}
                  >
                    <p className={cn("text-[10px] uppercase tracking-wider font-semibold mb-1", c.text)}>
                      {node.type.replace("_", " ")}
                    </p>
                    <p className="text-xs text-foreground/80">{node.label}</p>
                  </div>
                  {i < MOCK_CONVERTED_NODES.length - 1 && (
                    <div className="flex items-center mx-1">
                      <div className="w-6 h-0.5 bg-muted-foreground/30" />
                      <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-muted-foreground/30" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Grid dots background */}
          <div
            className="absolute inset-0 pointer-events-none opacity-20"
            style={{
              backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />
        </div>
      </div>

      {/* Warnings */}
      {unsupportedCount > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <p className="text-sm font-semibold text-amber-300">
              {unsupportedCount} node type{unsupportedCount !== 1 ? "s" : ""} cannot be converted
            </p>
          </div>
          <ul className="space-y-1 ml-6">
            {MOCK_NODE_MAPPING.filter((n) => !n.supported).map((n) => (
              <li key={n.leandata} className="text-xs text-amber-400/80 list-disc">
                <strong>{n.leandata}</strong> &mdash; third-party integration, not applicable
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onComplete} className="gap-2">
          Import to Flow Builder
          <Download className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Step 4: Import                                                             */
/* -------------------------------------------------------------------------- */

function ImportStep() {
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)

  const startImport = useCallback(() => {
    setImporting(true)
    setTimeout(() => {
      setImporting(false)
      setDone(true)
    }, 2000)
  }, [])

  return (
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-green-500/20 border border-emerald-500/30">
          <Download className="h-8 w-8 text-emerald-400" />
        </div>
        <h2 className="text-xl font-semibold">Import Converted Flow</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Save the converted routing flow to your Flow Builder. You can edit it after import.
        </p>
      </div>

      {!done && !importing && (
        <div className="space-y-4">
          {/* Import summary */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h3 className="text-sm font-semibold">Import Summary</h3>
            <div className="space-y-3">
              {MOCK_LEANDATA_FLOWS.map((flow) => (
                <div
                  key={flow.name}
                  className="flex items-center justify-between py-2 border-b border-border last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="text-sm font-medium">{flow.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{flow.nodeCount} nodes</span>
                    <ArrowRight className="h-3 w-3" />
                    <Badge variant="secondary" className="text-[10px]">
                      {flow.objectType}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-center">
            <Button size="lg" onClick={startImport} className="gap-2 px-8">
              <Download className="h-4 w-4" />
              Confirm Import
            </Button>
          </div>
        </div>
      )}

      {importing && (
        <div className="rounded-xl border border-border bg-card p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">Importing flows...</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-1000 w-3/4" />
          </div>
        </div>
      )}

      {done && (
        <div className="space-y-6">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-6 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <div>
              <p className="text-lg font-semibold text-emerald-300">Import Complete</p>
              <p className="text-sm text-emerald-400/80 mt-1">
                {MOCK_LEANDATA_FLOWS.length} routing flow{MOCK_LEANDATA_FLOWS.length !== 1 ? "s" : ""} have
                been imported to your Flow Builder.
              </p>
            </div>

            <div className="flex justify-center gap-3 pt-2">
              <Button asChild className="gap-2">
                <Link href="/flow-builder/LEAD">
                  Open Flow Builder
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/routing-rules">View Routing Rules</Link>
              </Button>
            </div>
          </div>

          {/* Post-import tips */}
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-400" />
              Next Steps
            </h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">1.</span>
                Review the imported flow in the Flow Builder and adjust any node configurations.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">2.</span>
                Set up Round Robin teams if your LeanData flow used pool-based assignment.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">3.</span>
                Activate the routing rule when you are ready to go live.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-emerald-400 mt-0.5">4.</span>
                Disable or remove the LeanData trigger in Salesforce to avoid conflicts.
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/*  Main Page                                                                  */
/* -------------------------------------------------------------------------- */

export default function LeandataMigrationPage() {
  const [currentStep, setCurrentStep] = useState(0)
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null)

  return (
    <div className="space-y-8 max-w-3xl mx-auto pb-16">
      {/* Page header */}
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight font-display">
            Migrate from LeanData
          </h1>
          <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 hover:bg-violet-500/20 text-[10px] uppercase tracking-wider">
            Beta
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Automatically convert your LeanData routing flows to our format. No manual rebuild required.
        </p>
      </div>

      {/* Coming soon banner */}
      <div className="rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-950/30 via-blue-950/20 to-violet-950/30 p-4 flex items-center gap-3">
        <Shield className="h-5 w-5 text-violet-400 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-violet-300">
            Full migration coming soon
          </p>
          <p className="text-xs text-violet-400/70 mt-0.5">
            Step 1 performs a real scan of your Salesforce org. Steps 2-4 use demo data to preview the migration experience.
          </p>
        </div>
        <Badge variant="outline" className="border-violet-500/30 text-violet-300 text-[10px] shrink-0">
          Preview
        </Badge>
      </div>

      {/* Step indicator */}
      <StepIndicator currentStep={currentStep} />

      {/* Step content */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        {currentStep === 0 && (
          <DetectStep
            onComplete={(result) => {
              setDetectionResult(result)
              setCurrentStep(1)
            }}
          />
        )}

        {currentStep === 1 && (
          <AnalyzeStep onComplete={() => setCurrentStep(2)} />
        )}

        {currentStep === 2 && (
          <PreviewStep onComplete={() => setCurrentStep(3)} />
        )}

        {currentStep === 3 && <ImportStep />}
      </div>

      {/* Back button */}
      {currentStep > 0 && currentStep < 3 && (
        <div className="flex justify-start">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentStep((s) => s - 1)}
            className="gap-2 text-muted-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
        </div>
      )}
    </div>
  )
}
