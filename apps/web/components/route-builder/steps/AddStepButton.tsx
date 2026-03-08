"use client"

import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  onClick: () => void
  className?: string
}

export function AddStepButton({ onClick, className }: Props) {
  return (
    <div className={cn("flex flex-col items-center", className)}>
      {/* Connector line above */}
      <div className="w-px h-4 bg-border" />

      <button
        type="button"
        onClick={onClick}
        aria-label="Add step"
        className={cn(
          "group relative flex items-center justify-center",
          "size-8 rounded-full border-2 border-dashed border-border bg-background",
          "text-muted-foreground transition-all duration-150",
          "hover:border-primary hover:text-primary hover:bg-primary/5",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        )}
      >
        <Plus className="size-4 transition-transform duration-150 group-hover:scale-110" />
      </button>

      {/* Connector line below */}
      <div className="w-px h-4 bg-border" />
    </div>
  )
}
