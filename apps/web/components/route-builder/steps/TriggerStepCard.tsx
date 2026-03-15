"use client"

import { Zap, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { TriggerConfig } from "../types"
import { triggerEventLabel } from "../types"

interface Props {
  trigger: TriggerConfig
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
        "relative rounded-xl border-2 border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950 px-5 py-4",
        "flex items-center justify-between gap-4 w-full max-w-lg"
      )}
    >
      {/* Left: icon + label */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex-shrink-0 flex items-center justify-center size-9 rounded-lg bg-violet-100 dark:bg-violet-900 text-violet-600 dark:text-violet-400">
          <Zap className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-violet-400 dark:text-violet-500 uppercase tracking-wider">
              Step {stepNumber} — Trigger
            </span>
            {trigger.isDryRun && (
              <Badge
                variant="outline"
                className="text-[10px] border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950"
              >
                Dry run
              </Badge>
            )}
          </div>
          <p className="text-sm font-semibold text-violet-900 dark:text-violet-100 mt-0.5 truncate">
            {label}
          </p>
          <p className="text-xs text-violet-500 dark:text-violet-400 mt-0.5">
            Object: {objectLabel}
          </p>
        </div>
      </div>

      {/* Right: edit */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="flex-shrink-0 text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900"
        onClick={onEdit}
        aria-label="Edit trigger"
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  )
}
