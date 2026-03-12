"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { X, ArrowRight, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { EnglishSection } from "@/lib/route-to-english"
import { OPERATOR_LABELS } from "@/lib/route-to-english"
import type { RoutePath, MatchConfig, DefaultOwner, RouteBuilderState } from "./types"
import type { ConditionGroup, Condition } from "@/components/condition-builder/types"

interface PathDetailPanelProps {
  section: EnglishSection
  path?: RoutePath
  matchConfig?: MatchConfig | null
  trigger?: RouteBuilderState["trigger"]
  defaultOwner?: DefaultOwner | null
  onClose: () => void
  onEditInCanvas: (pathId?: string) => void
}

const NO_VALUE_OPS = new Set(["is_blank", "is_not_blank", "is_true", "is_false"])

function matchActionShort(
  action: string,
  custom: { assignmentType: string; assigneeName: string } | null
): string {
  switch (action) {
    case "SFDC_MERGE": return "→ merge"
    case "ASSIGN_TO_OWNER": return "→ assign to owner"
    case "SKIP": return "→ skip"
    case "ASSIGN_CUSTOM":
      return custom ? `→ ${custom.assigneeName}` : "→ not configured"
    default: return ""
  }
}

function ConditionToken({ condition }: { condition: Condition }) {
  const opLabel = OPERATOR_LABELS[condition.operator] ?? condition.operator

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
        {condition.fieldApiName}
      </span>
      <span className="text-muted-foreground">{opLabel}</span>
      {!NO_VALUE_OPS.has(condition.operator) && condition.value && (
        <span className="font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
          {condition.value}
        </span>
      )}
    </span>
  )
}

function ConditionGroupDisplay({ group }: { group: ConditionGroup }) {
  return (
    <div className="flex flex-col gap-1">
      {group.conditions.map((cond, i) => (
        <div key={cond.id} className="flex items-start gap-1.5">
          {i > 0 && (
            <span className="text-[10px] uppercase font-semibold text-muted-foreground mt-1 min-w-[28px]">
              {group.conjunction}
            </span>
          )}
          {i === 0 && <span className="min-w-[28px]" />}
          <ConditionToken condition={cond} />
        </div>
      ))}
    </div>
  )
}

export function PathDetailPanel({
  section,
  path,
  matchConfig,
  trigger,
  defaultOwner,
  onClose,
  onEditInCanvas,
}: PathDetailPanelProps) {
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
    const onUp = () => {
      dragRef.current = null
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  const assignmentLabel = path?.action.assignmentType
    ? path.action.assignmentType === "USER"
      ? "User"
      : path.action.assignmentType === "ROUND_ROBIN"
      ? "Round Robin"
      : "Queue"
    : null

  return (
    <div
      className="flex-shrink-0 border-l bg-white overflow-y-auto relative"
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
        {/* Path conditions detail */}
        {section.type === "path" && path && (
          <>
            {path.conditions.length > 0 ? (
              <div>
                <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">
                  Conditions
                </h4>
                <div className="space-y-3">
                  {path.conditions.map((group, i) => (
                    <div key={group.id}>
                      {i > 0 && (
                        <div className="flex items-center gap-2 my-2">
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-[10px] uppercase font-semibold text-muted-foreground">
                            or
                          </span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                      )}
                      <div className="rounded-md border bg-muted/30 p-2.5">
                        <ConditionGroupDisplay group={group} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-1">
                  Conditions
                </h4>
                <p className="text-xs text-muted-foreground">
                  No conditions — catches all remaining records
                </p>
              </div>
            )}

            {/* Assignment detail */}
            <div>
              <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">
                Assignment
              </h4>
              {assignmentLabel ? (
                <div className="rounded-md border bg-muted/30 p-2.5 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                      {assignmentLabel}
                    </span>
                  </div>
                  {path.action.assigneeName && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {path.action.assignmentType === "ROUND_ROBIN" ? "Team:" : path.action.assignmentType === "QUEUE" ? "Queue:" : "User:"}
                      </span>
                      <span className="font-semibold text-foreground">{path.action.assigneeName}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-red-600 font-medium">
                  Not configured
                </p>
              )}
            </div>

            {/* Position info */}
            {section.pathIndex !== undefined && (
              <p className="text-[11px] text-muted-foreground">
                Evaluated {ordinal(section.pathIndex + 1)} in order
              </p>
            )}
          </>
        )}

        {/* Trigger section detail */}
        {section.type === "trigger" && trigger && (
          <>
            <div>
              <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">
                Configuration
              </h4>
              <div className="rounded-md border bg-muted/30 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Object:</span>
                  <span className="font-medium text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">
                    {trigger.objectType === "LEAD" ? "Lead" : trigger.objectType === "CONTACT" ? "Contact" : "Account"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Event:</span>
                  <span className="font-medium">
                    {trigger.triggerEvent === "INSERT" ? "Created" : trigger.triggerEvent === "UPDATE" ? "Updated" : "Created or Updated"}
                  </span>
                </div>
                {trigger.triggerName && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Name:</span>
                    <span className="font-medium">{trigger.triggerName}</span>
                  </div>
                )}
                {trigger.isDryRun && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                      Dry Run Active
                    </span>
                  </div>
                )}
              </div>
            </div>
            {trigger.triggerConditions.length > 0 && trigger.triggerConditions.some(g => g.conditions.length > 0) && (
              <div>
                <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">
                  Criteria
                </h4>
                <div className="space-y-3">
                  {trigger.triggerConditions.filter(g => g.conditions.length > 0).map((group, i) => (
                    <div key={group.id}>
                      {i > 0 && (
                        <div className="flex items-center gap-2 my-2">
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-[10px] uppercase font-semibold text-muted-foreground">or</span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                      )}
                      <div className="rounded-md border bg-muted/30 p-2.5">
                        <ConditionGroupDisplay group={group} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Match section detail */}
        {section.type === "match" && matchConfig && (
          <>
            <div>
              <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">
                Objects Checked
              </h4>
              <div className="rounded-md border bg-muted/30 p-2.5 space-y-1.5">
                {matchConfig.checkLeads && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">Leads</span>
                    <span className="text-muted-foreground">{matchActionShort(matchConfig.onLeadMatch, matchConfig.leadCustomAssignment)}</span>
                  </div>
                )}
                {matchConfig.checkContacts && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">Contacts</span>
                    <span className="text-muted-foreground">{matchActionShort(matchConfig.onContactMatch, matchConfig.contactCustomAssignment)}</span>
                  </div>
                )}
                {matchConfig.checkAccounts && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">Accounts</span>
                    <span className="text-muted-foreground">{matchActionShort(matchConfig.onAccountMatch, matchConfig.accountCustomAssignment)}</span>
                  </div>
                )}
              </div>
            </div>
            <div>
              <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">
                Match Fields
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {matchConfig.matchEmail && <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">Email</span>}
                {matchConfig.matchPhone && <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">Phone</span>}
                {matchConfig.matchDomain && <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">Domain</span>}
                {matchConfig.matchCompanyName && <span className="text-xs font-medium text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">Company Name</span>}
              </div>
            </div>
            {matchConfig.fuzzyMatchMode !== "STRICT" && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Mode:</span>
                <span className="font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                  {matchConfig.fuzzyMatchMode === "FUZZY" ? "Fuzzy" : "AI Smart"}
                </span>
              </div>
            )}
          </>
        )}

        {/* Default Owner section detail */}
        {section.type === "default" && defaultOwner && (
          <div>
            <h4 className="text-[11px] font-semibold uppercase text-muted-foreground mb-2">
              Fallback Assignment
            </h4>
            <div className="rounded-md border bg-muted/30 p-2.5 space-y-1.5">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Type:</span>
                <span className="font-medium text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                  {defaultOwner.assignmentType === "USER" ? "User" : defaultOwner.assignmentType === "ROUND_ROBIN" ? "Round Robin" : "Queue"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">
                  {defaultOwner.assignmentType === "ROUND_ROBIN" ? "Team:" : defaultOwner.assignmentType === "QUEUE" ? "Queue:" : "User:"}
                </span>
                <span className="font-semibold text-foreground">{defaultOwner.assigneeName}</span>
              </div>
            </div>
          </div>
        )}

        {/* Edit in Canvas button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={() => onEditInCanvas(path?.id)}
        >
          Edit in Canvas
          <ArrowRight className="size-3" />
        </Button>
      </div>
    </div>
  )
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
