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
    iconBg: "bg-violet-100 dark:bg-violet-900",
    iconColor: "text-violet-600 dark:text-violet-400",
  },
  match: {
    icon: Search,
    borderOk: "border-l-blue-500",
    iconBg: "bg-blue-100 dark:bg-blue-900",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  path: {
    icon: Filter,
    borderOk: "border-l-indigo-500",
    iconBg: "bg-indigo-100 dark:bg-indigo-900",
    iconColor: "text-indigo-600 dark:text-indigo-400",
  },
  default: {
    icon: AlertTriangle,
    borderOk: "border-l-amber-500",
    iconBg: "bg-amber-100 dark:bg-amber-900",
    iconColor: "text-amber-600 dark:text-amber-400",
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
  const baseMeta = SECTION_META[section.type]
  // Override styling for search triggers (teal + Search icon instead of violet + Zap)
  const meta = section.id === "search-trigger"
    ? { icon: Search, borderOk: "border-l-teal-500", iconBg: "bg-teal-100 dark:bg-teal-900", iconColor: "text-teal-600 dark:text-teal-400" }
    : baseMeta
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
        "border-l-4 rounded-lg border bg-white dark:bg-gray-900 transition-colors cursor-pointer",
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
          <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300">
            Error
          </span>
        )}
        {section.status === "warning" && (
          <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
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
