"use client"

import { useState, useMemo, useRef, useCallback } from "react"
import { AlertCircle, AlertTriangle, Info, ChevronsUpDown } from "lucide-react"
import { routeToEnglish } from "@/lib/route-to-english"
import type { EnglishSection, RouteWarning } from "@/lib/route-to-english"
import type { RouteBuilderState } from "./types"
import { EnglishSectionCard } from "./EnglishSectionCard"
import { PathDetailPanel } from "./PathDetailPanel"

interface EnglishViewProps {
  state: RouteBuilderState
  onEditInCanvas: (pathId?: string) => void
}

export function EnglishView({ state, onEditInCanvas }: EnglishViewProps) {
  const review = useMemo(() => routeToEnglish(state), [state])

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)
  const [warningsExpanded, setWarningsExpanded] = useState(true)

  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Separate sections by type
  const triggerSection = review.sections.find((s) => s.type === "trigger" && s.id === "trigger")
  const searchTriggerSection = review.sections.find((s) => s.type === "trigger" && s.id === "search-trigger")
  const matchSection = review.sections.find((s) => s.type === "match")
  const pathSections = review.sections.filter((s) => s.type === "path")
  const defaultSection = review.sections.find((s) => s.type === "default")

  const selectedSection = selectedSectionId
    ? review.sections.find((s) => s.id === selectedSectionId) ?? null
    : null

  const selectedPath = selectedSection?.type === "path"
    ? state.paths[selectedSection.pathIndex ?? -1] ?? null
    : null

  const toggleExpand = useCallback((id: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    setExpandedPaths(new Set(pathSections.map((s) => s.id)))
  }, [pathSections])

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set())
  }, [])

  const allExpanded = pathSections.length > 0 && pathSections.every((s) => expandedPaths.has(s.id))

  const handleWarningClick = useCallback((warning: RouteWarning) => {
    if (warning.relatedSection) {
      setSelectedSectionId(warning.relatedSection)
      const el = sectionRefs.current.get(warning.relatedSection)
      el?.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [])

  const errorCount = review.warnings.filter((w) => w.severity === "error").length
  const warningCount = review.warnings.filter((w) => w.severity === "warning").length
  const infoCount = review.warnings.filter((w) => w.severity === "info").length

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left: scrollable sections */}
      <div className="flex-1 overflow-y-auto p-6 space-y-1">
        {/* Trigger */}
        {triggerSection && (
          <div ref={(el) => { if (el) sectionRefs.current.set(triggerSection.id, el) }}>
            <EnglishSectionCard
              section={triggerSection}
              isExpanded={true}
              onToggleExpand={() => {}}
              onSelect={setSelectedSectionId}
              isSelected={selectedSectionId === triggerSection.id}
            />
          </div>
        )}

        {/* Search Trigger */}
        {searchTriggerSection && (
          <>
            {triggerSection && <Divider />}
            <div ref={(el) => { if (el) sectionRefs.current.set(searchTriggerSection.id, el) }}>
              <EnglishSectionCard
                section={searchTriggerSection}
                isExpanded={true}
                onToggleExpand={() => {}}
                onSelect={setSelectedSectionId}
                isSelected={selectedSectionId === searchTriggerSection.id}
              />
            </div>
          </>
        )}

        {/* Match */}
        {matchSection && (
          <>
            <Divider />
            <div ref={(el) => { if (el) sectionRefs.current.set(matchSection.id, el) }}>
              <EnglishSectionCard
                section={matchSection}
                isExpanded={true}
                onToggleExpand={() => {}}
                onSelect={setSelectedSectionId}
                isSelected={selectedSectionId === matchSection.id}
              />
            </div>
          </>
        )}

        {/* Routing Paths */}
        {pathSections.length > 0 && (
          <>
            <Divider />
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                  Routing Paths
                </h3>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                  {pathSections.length}
                </span>
              </div>
              <button
                type="button"
                onClick={allExpanded ? collapseAll : expandAll}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronsUpDown className="size-3" />
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
            </div>
            <div className="space-y-1">
              {pathSections.map((section) => (
                <div
                  key={section.id}
                  ref={(el) => { if (el) sectionRefs.current.set(section.id, el) }}
                >
                  <EnglishSectionCard
                    section={section}
                    isExpanded={expandedPaths.has(section.id)}
                    onToggleExpand={() => toggleExpand(section.id)}
                    onSelect={setSelectedSectionId}
                    isSelected={selectedSectionId === section.id}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* Default Owner */}
        {defaultSection && (
          <>
            <Divider />
            <div ref={(el) => { if (el) sectionRefs.current.set(defaultSection.id, el) }}>
              <EnglishSectionCard
                section={defaultSection}
                isExpanded={true}
                onToggleExpand={() => {}}
                onSelect={setSelectedSectionId}
                isSelected={selectedSectionId === defaultSection.id}
              />
            </div>
          </>
        )}

        {/* Warnings */}
        {review.warnings.length > 0 && (
          <>
            <Divider />
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setWarningsExpanded((v) => !v)}
                className="flex items-center gap-2 w-full text-left py-2"
              >
                <h3 className="text-xs font-semibold uppercase text-muted-foreground tracking-wide">
                  Validation
                </h3>
                <div className="flex items-center gap-1">
                  {errorCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300">
                      {errorCount} error{errorCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300">
                      {warningCount}
                    </span>
                  )}
                  {infoCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                      {infoCount}
                    </span>
                  )}
                </div>
              </button>

              {warningsExpanded && (
                <div className="space-y-1">
                  {review.warnings.map((w, i) => (
                    <WarningRow
                      key={i}
                      warning={w}
                      onClick={() => handleWarningClick(w)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right: detail panel */}
      {selectedSection && (
        <PathDetailPanel
          section={selectedSection}
          path={selectedPath ?? undefined}
          matchConfig={selectedSection.type === "match" ? state.matchConfig : undefined}
          trigger={selectedSection.type === "trigger" && selectedSection.id === "trigger" ? state.trigger : undefined}
          searchTrigger={selectedSection.type === "trigger" && selectedSection.id === "search-trigger" ? state.searchTrigger : undefined}
          defaultOwner={selectedSection.type === "default" ? state.defaultOwner : undefined}
          onClose={() => setSelectedSectionId(null)}
          onEditInCanvas={onEditInCanvas}
        />
      )}
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Divider() {
  return (
    <div className="py-1">
      <div className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />
    </div>
  )
}

function WarningRow({
  warning,
  onClick,
}: {
  warning: RouteWarning
  onClick: () => void
}) {
  const Icon =
    warning.severity === "error"
      ? AlertCircle
      : warning.severity === "warning"
      ? AlertTriangle
      : Info

  const colorClasses =
    warning.severity === "error"
      ? "text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800"
      : warning.severity === "warning"
      ? "text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800"
      : "text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800"

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "flex items-start gap-2 w-full text-left px-3 py-2 rounded-md border text-xs transition-colors hover:opacity-80",
        colorClasses,
      ].join(" ")}
    >
      <Icon className="size-3.5 mt-0.5 flex-shrink-0" />
      <span>{warning.message}</span>
    </button>
  )
}
