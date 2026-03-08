"use client"

import { useState, useRef, useEffect } from "react"
import { Check, Loader2, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Props {
  name: string
  onNameChange: (name: string) => void
  onSave: () => void
  isSaving: boolean
  isDirty: boolean
}

export function RouteHeader({ name, onNameChange, onSave, isSaving, isDirty }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep editValue in sync when name changes externally (e.g. initial load)
  useEffect(() => {
    if (!isEditing) setEditValue(name)
  }, [name, isEditing])

  const startEditing = () => {
    setEditValue(name)
    setIsEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitEdit = () => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== name) {
      onNameChange(trimmed)
    } else if (!trimmed) {
      setEditValue(name)
    }
    setIsEditing(false)
  }

  const cancelEdit = () => {
    setEditValue(name)
    setIsEditing(false)
  }

  return (
    <div className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border bg-background/95 backdrop-blur px-6 py-3">
      {/* Left: editable route name */}
      <div className="flex items-center gap-2 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            autoFocus
            className={cn(
              "min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1",
              "text-lg font-semibold outline-none focus:ring-2 focus:ring-ring",
              "max-w-sm"
            )}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit()
              if (e.key === "Escape") cancelEdit()
            }}
            onBlur={commitEdit}
            aria-label="Route name"
          />
        ) : (
          <button
            type="button"
            onClick={startEditing}
            className={cn(
              "group flex items-center gap-2 rounded-md px-2 py-1 -ml-2",
              "text-lg font-semibold text-foreground",
              "hover:bg-muted/60 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
            aria-label="Click to rename route"
          >
            <span className="truncate max-w-xs">{name}</span>
            <Pencil className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
          </button>
        )}

        {isDirty && !isEditing && (
          <span className="text-xs text-muted-foreground flex-shrink-0">
            Unsaved changes
          </span>
        )}
      </div>

      {/* Right: save button */}
      <Button
        type="button"
        onClick={onSave}
        disabled={isSaving || !isDirty}
        className="flex-shrink-0 gap-2"
      >
        {isSaving ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Saving…
          </>
        ) : (
          <>
            <Check className="size-4" />
            Save Route
          </>
        )}
      </Button>
    </div>
  )
}
