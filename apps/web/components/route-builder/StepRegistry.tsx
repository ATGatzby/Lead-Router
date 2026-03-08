"use client"

import { Zap, Search, Filter, AlertTriangle } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

export type CanvasNodeType = "trigger" | "match" | "filter" | "assign" | "defaultOwner"

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
    color: "text-blue-600 bg-blue-100",
  },
  {
    type: "filter",
    icon: Filter,
    label: "Filter + Assign",
    description: "Add a branching path",
    color: "text-indigo-600 bg-indigo-100",
  },
  {
    type: "defaultOwner",
    icon: AlertTriangle,
    label: "Default Owner",
    description: "Fallback assignment",
    color: "text-amber-600 bg-amber-100",
  },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface StepRegistryProps {
  /** Node types already present on the canvas (used for greying out singles) */
  activeTypes: CanvasNodeType[]
}

// ─── Component ───────────────────────────────────────────────────────────────

export function StepRegistry({ activeTypes }: StepRegistryProps) {
  return (
    <div className="w-[220px] flex-shrink-0 border-l bg-white flex flex-col">
      {/* Panel header */}
      <div className="px-4 py-3 border-b">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Steps
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Trigger — always present, not draggable */}
        <div className="rounded-lg border border-dashed border-border px-3 py-2.5 opacity-60 select-none">
          <div className="flex items-center gap-2.5">
            <div className="flex-shrink-0 flex items-center justify-center size-7 rounded-md bg-violet-100 text-violet-600">
              <Zap className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium leading-tight">Trigger</p>
              <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                Always present
              </p>
            </div>
          </div>
        </div>

        {/* Draggable step cards */}
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
              className={[
                "rounded-lg border px-3 py-2.5 transition-colors",
                isAdded
                  ? "opacity-40 cursor-not-allowed border-border bg-muted/20 select-none"
                  : "border-border bg-white hover:border-primary hover:bg-primary/5 cursor-grab active:cursor-grabbing",
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
