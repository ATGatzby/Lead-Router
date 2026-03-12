"use client"

import { useState } from "react"
import { Zap, Search, Filter, AlertTriangle, ChevronRight, ChevronDown } from "lucide-react"
import type { EnglishSection } from "@/lib/route-to-english"

const SECTION_META: Record<
  EnglishSection["type"],
  { icon: React.ElementType; borderOk: string; iconBg: string; iconColor: string }
> = {
  trigger: {
    icon: Zap,
    borderOk: "border-l-violet-500",
    iconBg: "bg-violet-100",
    iconColor: "text-violet-600",
  },
  match: {
    icon: Search,
    borderOk: "border-l-blue-500",
    iconBg: "bg-blue-100",
    iconColor: "text-blue-600",
  },
  path: {
    icon: Filter,
    borderOk: "border-l-indigo-500",
    iconBg: "bg-indigo-100",
    iconColor: "text-indigo-600",
  },
  default: {
    icon: AlertTriangle,
    borderOk: "border-l-amber-500",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-600",
  },
}

interface EnglishSectionCardProps {
  section: EnglishSection
  isExpanded: boolean
  onToggleExpand: () => void
  onSelect: (sectionId: string) => void
  isSelected: boolean
}

export function EnglishSectionCard({
  section,
  isExpanded,
  onToggleExpand,
  onSelect,
  isSelected,
}: EnglishSectionCardProps) {
  const meta = SECTION_META[section.type]
  const Icon = meta.icon

  const borderColor =
    section.status === "error"
      ? "border-l-red-500"
      : section.status === "warning"
      ? "border-l-amber-500"
      : meta.borderOk

  const isPath = section.type === "path"
  const condCount = section.lines.length

  return (
    <div
      className={[
        "border-l-4 rounded-lg border bg-white transition-colors cursor-pointer",
        borderColor,
        isSelected ? "ring-2 ring-primary/30 shadow-md" : "hover:shadow-sm",
      ].join(" ")}
      onClick={() => onSelect(section.id)}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 h-10">
        {/* Expand chevron for paths */}
        {isPath ? (
          <button
            type="button"
            className="flex-shrink-0 flex items-center justify-center size-5 rounded text-muted-foreground hover:bg-muted transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
          >
            {isExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
          </button>
        ) : (
          <div
            className={[
              "flex-shrink-0 flex items-center justify-center size-5 rounded",
              meta.iconBg,
              meta.iconColor,
            ].join(" ")}
          >
            <Icon className="size-3" />
          </div>
        )}

        {/* Title */}
        <span className="text-xs font-semibold text-foreground truncate flex-1">
          {section.title}
        </span>

        {/* Status badge */}
        {section.status === "error" && (
          <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700">
            Error
          </span>
        )}
        {section.status === "warning" && (
          <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700">
            Warning
          </span>
        )}

        {/* Condition count badge for collapsed paths */}
        {isPath && !isExpanded && condCount > 0 && (
          <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
            {condCount} line{condCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Expanded content */}
      {(!isPath || isExpanded) && (
        <div className="px-3 pb-2.5 pt-0.5">
          {section.lines.map((line, i) => (
            <p key={i} className="text-xs text-muted-foreground leading-relaxed">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
