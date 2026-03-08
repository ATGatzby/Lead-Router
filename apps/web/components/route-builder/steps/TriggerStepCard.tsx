"use client"

import { Zap, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { RouteBuilderState } from "../types"
import { triggerEventLabel } from "../types"

interface Props {
  trigger: RouteBuilderState["trigger"]
  stepNumber: number
  onEdit: () => void
}

export function TriggerStepCard({ trigger, stepNumber, onEdit }: Props) {
  const label = triggerEventLabel(trigger.objectType, trigger.triggerEvent)

  const objectLabel =
    trigger.objectType === "LEAD"
      ? "Lead"
      : trigger.objectType === "CONTACT"
      ? "Contact"
      : "Account"

  return (
    <div
      className={cn(
        "relative rounded-xl border-2 border-violet-200 bg-violet-50 px-5 py-4",
        "flex items-center justify-between gap-4 w-full max-w-lg"
      )}
    >
      {/* Left: icon + label */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex-shrink-0 flex items-center justify-center size-9 rounded-lg bg-violet-100 text-violet-600">
          <Zap className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-violet-400 uppercase tracking-wider">
              Step {stepNumber} — Trigger
            </span>
            {trigger.isDryRun && (
              <Badge
                variant="outline"
                className="text-[10px] border-amber-300 text-amber-700 bg-amber-50"
              >
                Dry run
              </Badge>
            )}
          </div>
          <p className="text-sm font-semibold text-violet-900 mt-0.5 truncate">
            {label}
          </p>
          <p className="text-xs text-violet-500 mt-0.5">
            Object: {objectLabel}
          </p>
        </div>
      </div>

      {/* Right: edit */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="flex-shrink-0 text-violet-400 hover:text-violet-700 hover:bg-violet-100"
        onClick={onEdit}
        aria-label="Edit trigger"
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  )
}
