"use client"

import { UserCheck, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PathAction } from "../types"

interface Props {
  action: PathAction
  onEdit: () => void
}

function assignmentLabel(action: PathAction): string {
  if (!action.assignmentType || !action.assigneeId) return "No assignee set"
  if (action.assigneeName) return action.assigneeName
  switch (action.assignmentType) {
    case "USER":
      return "Individual user"
    case "ROUND_ROBIN":
      return "Round-robin team"
    case "QUEUE":
      return "Salesforce queue"
  }
}

function assignmentTypeLabel(type: PathAction["assignmentType"]): string | null {
  if (!type) return null
  switch (type) {
    case "USER":
      return "User"
    case "ROUND_ROBIN":
      return "Round Robin"
    case "QUEUE":
      return "Queue"
  }
}

export function ActionStepCard({ action, onEdit }: Props) {
  const isConfigured = !!(action.assignmentType && action.assigneeId)
  const typeLabel = assignmentTypeLabel(action.assignmentType)

  return (
    <div
      className={cn(
        "rounded-lg border-2 px-4 py-3",
        "flex items-center justify-between gap-3",
        isConfigured
          ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950"
          : "border-green-100 dark:border-green-900 bg-green-50/40 dark:bg-green-950/40"
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={cn(
            "flex-shrink-0 flex items-center justify-center size-7 rounded-md",
            isConfigured
              ? "bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400"
              : "bg-green-50 dark:bg-green-950 text-green-400 dark:text-green-500"
          )}
        >
          <UserCheck className="size-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-green-900 dark:text-green-100">Assign To</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {typeLabel && (
              <span className="text-[10px] font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900 px-1 py-0.5 rounded">
                {typeLabel}
              </span>
            )}
            <span
              className={cn(
                "text-xs truncate",
                isConfigured ? "text-green-700 dark:text-green-300" : "text-green-400 dark:text-green-500 italic"
              )}
            >
              {assignmentLabel(action)}
            </span>
          </div>
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="flex-shrink-0 text-green-400 hover:text-green-700 dark:hover:text-green-300 hover:bg-green-100 dark:hover:bg-green-900"
        onClick={onEdit}
        aria-label="Edit assignment"
      >
        <Pencil className="size-3" />
      </Button>
    </div>
  )
}
