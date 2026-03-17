"use client"

import { Filter, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { ConditionGroup } from "@/components/condition-builder/types"

interface Props {
  conditions: ConditionGroup[]
  onEdit: () => void
}

export function FilterStepCard({ conditions, onEdit }: Props) {
  const conditionCount = conditions.reduce((sum, g) => sum + (g.conditions ?? []).length, 0)
  const isCatchAll = conditionCount === 0

  return (
    <div
      className={cn(
        "rounded-lg border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950 px-4 py-3",
        "flex items-center justify-between gap-3"
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex-shrink-0 flex items-center justify-center size-7 rounded-md bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400">
          <Filter className="size-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-100">Filters</p>
          {isCatchAll ? (
            <p className="text-xs text-indigo-400 dark:text-indigo-500 mt-0.5 italic">No conditions (catch-all)</p>
          ) : (
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1.5 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950"
              >
                {conditionCount} condition{conditionCount !== 1 ? "s" : ""}
              </Badge>
              <span className="text-xs text-indigo-500 dark:text-indigo-400">
                across {conditions.length} group{conditions.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="flex-shrink-0 text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900"
        onClick={onEdit}
        aria-label="Edit filter conditions"
      >
        <Pencil className="size-3" />
      </Button>
    </div>
  )
}
