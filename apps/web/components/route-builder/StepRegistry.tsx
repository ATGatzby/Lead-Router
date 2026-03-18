"use client"

import { Zap, Search, Filter, UserCheck, AlertTriangle, SearchIcon, Pencil, ClipboardList, GitBranch } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

export type CanvasNodeType = "trigger" | "searchTrigger" | "match" | "filter" | "assign" | "defaultOwner" | "split" | "updateField" | "createTask"

interface StepDefinition {
  type: CanvasNodeType
  icon: React.ElementType
  label: string
  description: string
  color: string
}

const STEPS: StepDefinition[] = [
  {
    type: "match",
    icon: Search,
    label: "Match",
    description: "Check for existing records",
    color: "text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900",
  },
  {
    type: "filter",
    icon: Filter,
    label: "Filter",
    description: "Route by conditions",
    color: "text-indigo-600 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-900",
  },
  {
    type: "assign" as CanvasNodeType,
    icon: UserCheck,
    label: "Assign",
    description: "Assign record to owner",
    color: "text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900",
  },
  {
    type: "updateField",
    icon: Pencil,
    label: "Update Field",
    description: "Set a field value on record",
    color: "text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900",
  },
  {
    type: "createTask",
    icon: ClipboardList,
    label: "Create Task",
    description: "Create a follow-up task",
    color: "text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-900",
  },
  {
    type: "split" as CanvasNodeType,
    icon: GitBranch,
    label: "Split",
    description: "Branch into sub-paths",
    color: "text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800",
  },
  {
    type: "defaultOwner",
    icon: AlertTriangle,
    label: "Default Owner",
    description: "Fallback assignment",
    color: "text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900",
  },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface StepRegistryProps {
  /** Node types already present on the canvas (used for greying out singles) */
  activeTypes: CanvasNodeType[]
  /** Called when a step is clicked to add it to the canvas */
  onAddStep?: (type: CanvasNodeType) => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StepRegistry({ activeTypes, onAddStep }: StepRegistryProps) {
  return (
    <div className="w-[220px] flex-shrink-0 border-l bg-white dark:bg-gray-950 flex flex-col">
      {/* Panel header */}
      <div className="px-4 py-3 border-b">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Steps
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Section: Triggers */}
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-1">
          Triggers
        </p>

        {/* Real-Time Trigger — singleton */}
        {(() => {
          const isAdded = activeTypes.includes("trigger")
          return (
            <div
              draggable={!isAdded}
              onDragStart={(e) => {
                if (isAdded) return
                e.dataTransfer.setData("stepType", "trigger")
                e.dataTransfer.effectAllowed = "copy"
              }}
              onClick={() => !isAdded && onAddStep?.("trigger")}
              className={[
                "rounded-lg border px-3 py-2.5 transition-colors",
                isAdded
                  ? "opacity-40 cursor-not-allowed border-border bg-muted/20 select-none"
                  : "border-border bg-white dark:bg-gray-900 hover:border-violet-500 hover:bg-violet-50/50 dark:hover:bg-violet-950/50 cursor-pointer",
              ].join(" ")}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex-shrink-0 flex items-center justify-center size-7 rounded-md bg-violet-100 dark:bg-violet-900 text-violet-600 dark:text-violet-400">
                  <Zap className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-tight">
                    Real-Time Trigger
                    {isAdded && (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                        (added)
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    Apex trigger on record change
                  </p>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Search Salesforce Trigger — singleton */}
        {(() => {
          const isAdded = activeTypes.includes("searchTrigger")
          return (
            <div
              draggable={!isAdded}
              onDragStart={(e) => {
                if (isAdded) return
                e.dataTransfer.setData("stepType", "searchTrigger")
                e.dataTransfer.effectAllowed = "copy"
              }}
              onClick={() => !isAdded && onAddStep?.("searchTrigger")}
              className={[
                "rounded-lg border px-3 py-2.5 transition-colors",
                isAdded
                  ? "opacity-40 cursor-not-allowed border-border bg-muted/20 select-none"
                  : "border-border bg-white dark:bg-gray-900 hover:border-teal-500 hover:bg-teal-50/50 dark:hover:bg-teal-950/50 cursor-pointer",
              ].join(" ")}
            >
              <div className="flex items-center gap-2.5">
                <div className="flex-shrink-0 flex items-center justify-center size-7 rounded-md bg-teal-100 dark:bg-teal-900 text-teal-600 dark:text-teal-400">
                  <SearchIcon className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-tight">
                    Search Salesforce
                    {isAdded && (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                        (added)
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    Query records on a schedule
                  </p>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Section: Actions */}
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider pt-2">
          Actions
        </p>

        {/* Step cards — click or drag to add */}
        {STEPS.map((step) => {
          const Icon = step.icon
          // "match" and "defaultOwner" are singletons — grey out if already on canvas
          const isSingleton = step.type === "match" || step.type === "defaultOwner"
          const isAdded = isSingleton && activeTypes.includes(step.type)

          return (
            <div
              key={step.type}
              draggable={!isAdded}
              onDragStart={(e) => {
                if (isAdded) return
                e.dataTransfer.setData("stepType", step.type)
                e.dataTransfer.effectAllowed = "copy"
              }}
              onClick={() => !isAdded && onAddStep?.(step.type)}
              className={[
                "rounded-lg border px-3 py-2.5 transition-colors",
                isAdded
                  ? "opacity-40 cursor-not-allowed border-border bg-muted/20 select-none"
                  : "border-border bg-white dark:bg-gray-900 hover:border-primary hover:bg-primary/5 cursor-pointer",
              ].join(" ")}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={[
                    "flex-shrink-0 flex items-center justify-center size-7 rounded-md",
                    step.color,
                  ].join(" ")}
                >
                  <Icon className="size-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium leading-tight">
                    {step.label}
                    {isAdded && (
                      <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                        (added)
                      </span>
                    )}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {step.description}
                  </p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
