"use client"

import { Search, Pencil, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { MatchConfig } from "../types"

interface Props {
  matchConfig: MatchConfig
  stepNumber: number
  onEdit: () => void
  onRemove: () => void
}

export function MatchStepCard({ matchConfig, stepNumber, onEdit, onRemove }: Props) {
  const checkingItems: string[] = []
  if (matchConfig.checkLeads) checkingItems.push("Leads")
  if (matchConfig.checkContacts) checkingItems.push("Contacts")
  if (matchConfig.checkAccounts) checkingItems.push("Accounts")

  const matchOnItems: string[] = []
  if (matchConfig.matchEmail) matchOnItems.push("Email")
  if (matchConfig.matchPhone) matchOnItems.push("Phone")
  if (matchConfig.matchDomain) matchOnItems.push("Domain")
  if (matchConfig.matchCompanyName) {
    const modeLabel = matchConfig.fuzzyMatchMode === "AI_SMART" ? "AI" : matchConfig.fuzzyMatchMode === "FUZZY" ? "Fuzzy" : "Strict"
    matchOnItems.push(`Company (${modeLabel})`)
  }

  return (
    <div
      className={cn(
        "relative rounded-xl border-2 border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-5 py-4",
        "flex items-center justify-between gap-4 w-full max-w-lg"
      )}
    >
      {/* Left: icon + summary */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex-shrink-0 flex items-center justify-center size-9 rounded-lg bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400">
          <Search className="size-5" />
        </div>
        <div className="min-w-0">
          <span className="text-xs font-medium text-blue-400 dark:text-blue-500 uppercase tracking-wider">
            Step {stepNumber} — Match Action
          </span>
          <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mt-0.5">
            Existing Record Check
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {checkingItems.length > 0 && (
              <span className="text-xs text-blue-600 dark:text-blue-400">
                Check: {checkingItems.join(", ")}
              </span>
            )}
            {checkingItems.length > 0 && matchOnItems.length > 0 && (
              <span className="text-blue-300 dark:text-blue-600">·</span>
            )}
            {matchOnItems.length > 0 && (
              <span className="text-xs text-blue-600 dark:text-blue-400">
                By: {matchOnItems.join(", ")}
              </span>
            )}
            {checkingItems.length === 0 && matchOnItems.length === 0 && (
              <span className="text-xs text-blue-400 dark:text-blue-500 italic">Not configured</span>
            )}
          </div>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900"
          onClick={onEdit}
          aria-label="Edit match step"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-blue-300 dark:text-blue-600 hover:text-destructive hover:bg-destructive/10"
          onClick={onRemove}
          aria-label="Remove match step"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
