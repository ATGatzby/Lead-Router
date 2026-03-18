"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { X, GripVertical, ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { EnglishSection } from "@/lib/route-to-english"

interface FlowDetailPanelProps {
  section: EnglishSection
  onClose: () => void
  onSwitchToCanvas: () => void
}

export function FlowDetailPanel({ section, onClose, onSwitchToCanvas }: FlowDetailPanelProps) {
  const [width, setWidth] = useState(320)
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
  }, [width])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const dx = dragRef.current.startX - e.clientX
      const newWidth = Math.max(280, Math.min(window.innerWidth * 0.5, dragRef.current.startWidth + dx))
      setWidth(newWidth)
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  const typeLabel =
    section.type === "trigger" ? "Trigger" :
    section.type === "match" ? "Match" :
    section.type === "path" ? "Routing Path" :
    section.type === "default" ? "Default Fallback" : "Section"

  const typeColor =
    section.type === "trigger" ? "text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950" :
    section.type === "match" ? "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950" :
    section.type === "path" ? "text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950" :
    "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950"

  return (
    <div
      className="flex-shrink-0 border-l bg-white dark:bg-gray-950 overflow-y-auto relative"
      style={{ width }}
    >
      {/* Drag handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/10 transition-colors flex items-center justify-center z-10"
        onMouseDown={handleDragStart}
      >
        <GripVertical className="size-3 text-muted-foreground/40" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h3 className="text-sm font-semibold truncate">{section.title}</h3>
        <button
          type="button"
          onClick={onClose}
          className="flex items-center justify-center size-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Type badge */}
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">Type</h4>
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${typeColor}`}>{typeLabel}</span>
        </div>

        {/* Status */}
        {section.status !== "ok" && (
          <div>
            <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">Status</h4>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
              section.status === "error"
                ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950"
                : "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950"
            }`}>
              {section.status === "error" ? "Error" : "Warning"}
            </span>
          </div>
        )}

        {/* Lines detail */}
        <div>
          <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">Details</h4>
          <div className="rounded-md border bg-muted/30 p-2.5 space-y-2">
            {section.lines.map((line, i) => (
              <p key={i} className="text-xs text-foreground leading-relaxed">{typeof line === "string" ? line : line.text}</p>
            ))}
          </div>
        </div>

        {/* Switch to canvas */}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={onSwitchToCanvas}
        >
          View in Canvas
          <ArrowRight className="size-3" />
        </Button>
      </div>
    </div>
  )
}
