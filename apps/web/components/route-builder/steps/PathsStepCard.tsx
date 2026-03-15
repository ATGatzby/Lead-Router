"use client"

import { useState } from "react"
import { GitBranch, MoreVertical, Plus, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { RoutePath } from "../types"
import { FilterStepCard } from "./FilterStepCard"
import { ActionStepCard } from "./ActionStepCard"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Props {
  paths: RoutePath[]
  stepNumber: number
  onAddPath: () => void
  onRenamePath: (pathId: string, newLabel: string) => void
  onRemovePath: (pathId: string) => void
  onEditFilter: (pathId: string) => void
  onEditAction: (pathId: string) => void
}

function RenameInput({
  initialValue,
  onSave,
  onCancel,
}: {
  initialValue: string
  onSave: (v: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initialValue)

  return (
    <input
      autoFocus
      className="w-full rounded border border-border px-2 py-0.5 text-sm font-medium outline-none focus:ring-2 focus:ring-ring"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSave(value.trim() || initialValue)
        if (e.key === "Escape") onCancel()
      }}
      onBlur={() => onSave(value.trim() || initialValue)}
    />
  )
}

export function PathsStepCard({
  paths,
  stepNumber,
  onAddPath,
  onRenamePath,
  onRemovePath,
  onEditFilter,
  onEditAction,
}: Props) {
  const [renamingPathId, setRenamingPathId] = useState<string | null>(null)

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 px-1">
        <div className="flex items-center justify-center size-7 rounded-md bg-slate-100 text-slate-500">
          <GitBranch className="size-4" />
        </div>
        <div>
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Step {stepNumber} —
          </span>
          <span className="text-sm font-semibold text-slate-700 ml-1">
            Split into Paths
          </span>
        </div>
      </div>

      {/* Path columns */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {paths.map((path, idx) => (
          <div
            key={path.id}
            className={cn(
              "flex-shrink-0 w-64 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-[#12121a]",
              "flex flex-col overflow-hidden"
            )}
          >
            {/* Column header */}
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-[#16161f]">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="flex-shrink-0 flex items-center justify-center size-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[10px] font-bold">
                  {idx + 1}
                </span>
                {renamingPathId === path.id ? (
                  <RenameInput
                    initialValue={path.label}
                    onSave={(v) => {
                      onRenamePath(path.id, v)
                      setRenamingPathId(null)
                    }}
                    onCancel={() => setRenamingPathId(null)}
                  />
                ) : (
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                    {path.label}
                  </span>
                )}
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="flex-shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                    aria-label="Path options"
                  >
                    <MoreVertical className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[140px]">
                  <DropdownMenuItem
                    onClick={() => setRenamingPathId(path.id)}
                    className="gap-2 text-xs"
                  >
                    <Pencil className="size-3" />
                    Rename path
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onRemovePath(path.id)}
                    disabled={paths.length <= 1}
                    className="gap-2 text-xs text-destructive focus:text-destructive"
                  >
                    <Trash2 className="size-3" />
                    Delete path
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Column body */}
            <div className="flex flex-col gap-2.5 p-3">
              <FilterStepCard
                conditions={path.conditions}
                onEdit={() => onEditFilter(path.id)}
              />
              <ActionStepCard
                action={path.action}
                onEdit={() => onEditAction(path.id)}
              />
            </div>
          </div>
        ))}

        {/* Add path button */}
        <div className="flex-shrink-0 flex items-start pt-1">
          <button
            type="button"
            onClick={onAddPath}
            className={cn(
              "group flex items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700",
              "px-4 py-3 text-sm text-slate-400 dark:text-slate-500 bg-transparent",
              "transition-all hover:border-primary hover:text-primary hover:bg-primary/5",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <Plus className="size-4 transition-transform group-hover:scale-110" />
            Add Path
          </button>
        </div>
      </div>
    </div>
  )
}
