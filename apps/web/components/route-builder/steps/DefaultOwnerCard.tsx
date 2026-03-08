"use client"

import { AlertTriangle, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { DefaultOwner } from "../types"

interface Props {
  defaultOwner: DefaultOwner | null
  onEdit: () => void
}

function ownerSummary(owner: DefaultOwner | null): string {
  if (!owner) return "Not configured — leads may go unassigned"
  if (owner.assigneeName) return owner.assigneeName
  switch (owner.assignmentType) {
    case "USER":
      return "Individual user"
    case "ROUND_ROBIN":
      return "Round-robin team"
    case "QUEUE":
      return "Salesforce queue"
  }
}

function ownerTypeLabel(owner: DefaultOwner | null): string | null {
  if (!owner) return null
  switch (owner.assignmentType) {
    case "USER":
      return "User"
    case "ROUND_ROBIN":
      return "Round Robin"
    case "QUEUE":
      return "Queue"
  }
}

export function DefaultOwnerCard({ defaultOwner, onEdit }: Props) {
  const isConfigured = !!defaultOwner
  const typeLabel = ownerTypeLabel(defaultOwner)

  return (
    <div
      className={cn(
        "relative rounded-xl border-2 px-5 py-4",
        "flex items-center justify-between gap-4 w-full max-w-lg",
        isConfigured
          ? "border-amber-200 bg-amber-50"
          : "border-amber-200 bg-amber-50/60 border-dashed"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            "flex-shrink-0 flex items-center justify-center size-9 rounded-lg",
            isConfigured ? "bg-amber-100 text-amber-600" : "bg-amber-50 text-amber-400"
          )}
        >
          <AlertTriangle className="size-5" />
        </div>
        <div className="min-w-0">
          <span className="text-xs font-medium text-amber-400 uppercase tracking-wider">
            Default Owner
          </span>
          <p className="text-sm font-semibold text-amber-900 mt-0.5">
            Fallback for entire flow
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {typeLabel && (
              <span className="text-[10px] font-medium text-amber-700 bg-amber-100 px-1 py-0.5 rounded">
                {typeLabel}
              </span>
            )}
            <span
              className={cn(
                "text-xs",
                isConfigured ? "text-amber-700" : "text-amber-500 italic"
              )}
            >
              {ownerSummary(defaultOwner)}
            </span>
          </div>
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="flex-shrink-0 text-amber-400 hover:text-amber-700 hover:bg-amber-100"
        onClick={onEdit}
        aria-label="Edit default owner"
      >
        <Pencil className="size-3.5" />
      </Button>
    </div>
  )
}
