"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Shield, Zap, GitBranch, UserCheck, Search, Clock, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConditionTable } from "./ConditionTable";
import { AssignmentCard } from "./AssignmentCard";
import { TimingBreakdown } from "./TimingBreakdown";

export interface JourneyEntry {
  id: string;
  eventType: string;
  status: string;
  ruleName: string | null;
  pathLabel: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assignmentType: string | null;
  teamName: string | null;
  routingDurationMs: number | null;
  decisionTrace: any;
  createdAt: string;
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  SUCCESS: { color: "text-green-700 dark:text-green-400", bg: "bg-green-500", label: "Success" },
  FAILED: { color: "text-red-700 dark:text-red-400", bg: "bg-red-500", label: "Failed" },
  UNMATCHED: { color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500", label: "Unmatched" },
  MERGED: { color: "text-blue-700 dark:text-blue-400", bg: "bg-blue-500", label: "Merged" },
  COOLDOWN_SKIPPED: { color: "text-sky-700 dark:text-sky-400", bg: "bg-sky-500", label: "Cooldown Skipped" },
  RETRY: { color: "text-amber-700 dark:text-amber-400", bg: "bg-amber-500", label: "Retry" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", second: "2-digit",
  });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function JourneyStep({ entry, isFirst }: { entry: JourneyEntry; isFirst: boolean }) {
  const [expanded, setExpanded] = useState(isFirst);
  const trace = entry.decisionTrace as any;
  const statusCfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.FAILED;

  return (
    <div className="relative pl-10">
      {/* Timeline dot */}
      <div
        className={cn(
          "absolute left-[11px] top-4 h-[10px] w-[10px] rounded-full ring-2 ring-background",
          statusCfg.bg
        )}
      />

      <div className="rounded-lg border bg-card">
        {/* Header */}
        <button
          className="w-full text-left px-4 py-3 flex items-center gap-3"
          onMouseDown={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full border", statusCfg.color)}>
                {statusCfg.label}
              </span>
              {entry.ruleName && (
                <span className="text-sm font-medium truncate">{entry.ruleName}</span>
              )}
              {entry.pathLabel && (
                <span className="text-xs text-muted-foreground">/ {entry.pathLabel}</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
              <span>{formatDate(entry.createdAt)}</span>
              <span>{timeAgo(entry.createdAt)}</span>
              {entry.routingDurationMs != null && (
                <span>{entry.routingDurationMs}ms</span>
              )}
            </div>
          </div>

          {entry.assigneeName && (
            <span className="text-xs text-muted-foreground shrink-0">
              → {entry.assigneeName}
            </span>
          )}
        </button>

        {/* Expanded content */}
        {expanded && (
          <div className="border-t px-4 py-4 space-y-1">
            {trace ? (
              <TraceDetail trace={trace} entry={entry} />
            ) : (
              <NoTraceDetail entry={entry} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function NoTraceDetail({ entry }: { entry: JourneyEntry }) {
  return (
    <div className="space-y-3">
      <div className="rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 p-3 text-sm text-blue-800 dark:text-blue-300">
        Detailed routing trace is not available for events before the Record Journey feature was enabled.
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">Event:</span> {entry.eventType}
        </div>
        <div>
          <span className="text-muted-foreground">Status:</span> {entry.status}
        </div>
        {entry.ruleName && (
          <div>
            <span className="text-muted-foreground">Rule:</span> {entry.ruleName}
          </div>
        )}
        {entry.assigneeName && (
          <div>
            <span className="text-muted-foreground">Assigned to:</span> {entry.assigneeName}
          </div>
        )}
      </div>
    </div>
  );
}

export function TraceDetail({ trace, entry }: { trace: any; entry: JourneyEntry }) {
  return (
    <div className="space-y-1">
      {/* Step 1: Trigger */}
      <CollapsibleStep
        icon={<Zap className="h-4 w-4" />}
        title="Trigger"
        stepNumber={1}
        status="success"
        summary={`${trace.trigger?.event} event — ${trace.trigger?.objectType}`}
        defaultOpen
      >
        <p className="text-sm">
          <span className="font-medium">{trace.trigger?.event}</span> event received
          {trace.trigger?.objectType && ` — new ${trace.trigger.objectType} created`}
        </p>
        {trace.trigger?.timestampMs && (
          <p className="text-xs text-muted-foreground mt-1">
            Timestamp: {new Date(trace.trigger.timestampMs).toLocaleString()}
          </p>
        )}
      </CollapsibleStep>

      {/* Step 2: Cooldown */}
      {trace.cooldown && (
        <CollapsibleStep
          icon={<Shield className="h-4 w-4" />}
          title="Cooldown Check"
          stepNumber={2}
          status={trace.cooldown.skipped ? "blocked" : "success"}
          summary={trace.cooldown.skipped ? "Blocked — recently routed" : "Passed — eligible"}
        >
          <p className="text-sm">
            {trace.cooldown.skipped
              ? "Blocked by cooldown — record was recently routed. No further processing."
              : "No active cooldown — record eligible for routing."}
          </p>
        </CollapsibleStep>
      )}

      {/* Step 3: Match Phase */}
      {trace.rulesEvaluated?.some((r: any) => r.matchPhase) && (
        <CollapsibleStep
          icon={<Search className="h-4 w-4" />}
          title="Match / Dedup Check"
          stepNumber={trace.cooldown ? 3 : 2}
          status="info"
          summary={
            trace.rulesEvaluated.find((r: any) => r.matchPhase)?.matchPhase?.result?.matched
              ? `Matched ${trace.rulesEvaluated.find((r: any) => r.matchPhase)?.matchPhase?.result?.matchedType}`
              : "No match found"
          }
          defaultOpen
        >
          {trace.rulesEvaluated
            .filter((r: any) => r.matchPhase)
            .map((r: any) => (
              <div key={r.ruleId} className="space-y-2">
                <p className="text-sm">
                  Checked for existing records matching this {trace.trigger?.objectType?.toLowerCase() ?? "record"}:
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {r.matchPhase.config.checkLeads && (
                    <div className="flex items-center gap-1">
                      <span className={r.matchPhase.result.matchedType === "LEAD" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
                        {r.matchPhase.result.matchedType === "LEAD" ? "✓" : "○"}
                      </span>
                      Leads (by {[r.matchPhase.config.matchEmail && "email", r.matchPhase.config.matchPhone && "phone"].filter(Boolean).join(", ") || "email"})
                    </div>
                  )}
                  {r.matchPhase.config.checkContacts && (
                    <div className="flex items-center gap-1">
                      <span className={r.matchPhase.result.matchedType === "CONTACT" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
                        {r.matchPhase.result.matchedType === "CONTACT" ? "✓" : "○"}
                      </span>
                      Contacts (by email)
                    </div>
                  )}
                  {r.matchPhase.config.checkAccounts && (
                    <div className="flex items-center gap-1">
                      <span className={r.matchPhase.result.matchedType === "ACCOUNT" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
                        {r.matchPhase.result.matchedType === "ACCOUNT" ? "✓" : "○"}
                      </span>
                      Accounts (by {[r.matchPhase.config.matchDomain && "domain", r.matchPhase.config.matchCompanyName && "company"].filter(Boolean).join(", ") || "domain"})
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Result: {r.matchPhase.result.matched
                    ? `Matched ${r.matchPhase.result.matchedType} — action: ${r.matchPhase.result.action ?? "assigned"}`
                    : "No match found — proceeding to rule evaluation"}
                </p>
              </div>
            ))}
        </CollapsibleStep>
      )}

      {/* Step 4: Rule Evaluation */}
      {trace.rulesEvaluated && trace.rulesEvaluated.length > 0 && (
        <CollapsibleStep
          icon={<GitBranch className="h-4 w-4" />}
          title="Rule Evaluation"
          stepNumber={trace.cooldown ? (trace.rulesEvaluated.some((r: any) => r.matchPhase) ? 4 : 3) : (trace.rulesEvaluated.some((r: any) => r.matchPhase) ? 3 : 2)}
          status="info"
          summary={`${trace.rulesEvaluated.length} rule${trace.rulesEvaluated.length !== 1 ? "s" : ""} evaluated`}
          defaultOpen
        >
          <div className="space-y-3">
            {trace.rulesEvaluated.map((rule: any) => (
              <RuleEvalDetail key={rule.ruleId} rule={rule} />
            ))}
          </div>
        </CollapsibleStep>
      )}

      {/* Step: Field Updates */}
      {trace.fieldUpdates && trace.fieldUpdates.length > 0 && (
        <CollapsibleStep
          icon={<Pencil className="h-4 w-4" />}
          title="Field Updates"
          stepNumber={
            (trace.cooldown ? 1 : 0) +
            (trace.rulesEvaluated?.some((r: any) => r.matchPhase) ? 1 : 0) +
            (trace.rulesEvaluated?.length > 0 ? 1 : 0) + 2
          }
          status="success"
          summary={`${trace.fieldUpdates.length} field${trace.fieldUpdates.length !== 1 ? "s" : ""} updated`}
          defaultOpen
        >
          <div className="space-y-1.5">
            {trace.fieldUpdates.map((fu: { field: string; value: string }, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="font-medium text-muted-foreground">{fu.field}</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{fu.value}</span>
              </div>
            ))}
          </div>
        </CollapsibleStep>
      )}

      {/* Step: Assignment */}
      {(trace.assignment || entry.assigneeName) && (() => {
        const isFailed = entry.status === "FAILED";
        const isRetry = entry.status === "RETRY";
        const assignStatus = isFailed ? "error" : isRetry ? "info" : "success";
        const assignSummary = isFailed
          ? "CRM write failed"
          : isRetry
            ? `→ ${entry.assigneeName ?? "Pending"} (awaiting CRM write)`
            : entry.assigneeName ? `→ ${entry.assigneeName}` : "Assigned";
        return (
        <CollapsibleStep
          icon={<UserCheck className="h-4 w-4" />}
          title="Assignment"
          stepNumber={
            (trace.cooldown ? 1 : 0) +
            (trace.rulesEvaluated?.some((r: any) => r.matchPhase) ? 1 : 0) +
            (trace.rulesEvaluated?.length > 0 ? 1 : 0) + 2
          }
          status={assignStatus}
          summary={assignSummary}
          defaultOpen
        >
          <AssignmentCard
            assignment={trace.assignment}
            assigneeName={entry.assigneeName}
            assignmentType={entry.assignmentType}
            teamName={entry.teamName}
          />
        </CollapsibleStep>
        ); })()}

      {/* Timing */}
      {trace.timing && (
        <CollapsibleStep
          icon={<Clock className="h-4 w-4" />}
          title="Timing Breakdown"
          stepNumber={0}
          status="info"
          summary={`${trace.timing.totalMs}ms total`}
          hideNumber
        >
          <TimingBreakdown timing={trace.timing} />
        </CollapsibleStep>
      )}
    </div>
  );
}

// ── Collapsible Step Section ─────────────────────────────────────────────

function CollapsibleStep({
  icon,
  title,
  stepNumber,
  status,
  summary,
  defaultOpen = false,
  hideNumber = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  stepNumber: number;
  status: "success" | "blocked" | "info" | "error";
  summary?: string;
  defaultOpen?: boolean;
  hideNumber?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const dotColor = {
    success: "bg-green-500",
    blocked: "bg-sky-500",
    info: "bg-slate-400 dark:bg-slate-500",
    error: "bg-red-500",
  }[status];

  const bgColor = {
    success: "hover:bg-green-50/50 dark:hover:bg-green-950/10",
    blocked: "hover:bg-sky-50/50 dark:hover:bg-sky-950/10",
    info: "hover:bg-slate-50/50 dark:hover:bg-slate-950/10",
    error: "hover:bg-red-50/50 dark:hover:bg-red-950/10",
  }[status];

  return (
    <div className="rounded-md border">
      <button
        className={cn("w-full text-left px-3 py-2.5 flex items-center gap-3 transition-colors rounded-md", bgColor)}
        onMouseDown={() => setOpen(!open)}
      >
        <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", dotColor)} />
        {!hideNumber && (
          <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">
            {stepNumber}
          </span>
        )}
        <div className="flex items-center gap-2 shrink-0">
          {icon}
          <span className="text-sm font-semibold">{title}</span>
        </div>
        {summary && !open && (
          <span className="text-xs text-muted-foreground truncate flex-1 ml-2">
            — {summary}
          </span>
        )}
        <div className="ml-auto shrink-0">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t ml-[22px]">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Rule Evaluation Detail ──────────────────────────────────────────────

/** Recursively render nested split evaluation traces */
function SplitTraceView({ splits, depth }: { splits: any[]; depth: number }) {
  return (
    <div className="mt-2 space-y-2" style={{ marginLeft: `${depth * 12}px` }}>
      {splits.map((split: any, si: number) => (
        <div key={si} className="space-y-1.5 border-l-2 border-indigo-200 dark:border-indigo-800 pl-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500 dark:text-indigo-400">
            Split · {split.paths?.length ?? 0} paths
          </p>
          {split.paths?.map((path: any, pi: number) => (
            <div key={pi} className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <span className={path.matched ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}>
                  {path.matched ? "✓" : "✗"}
                </span>
                <span>{path.label}</span>
                {!path.matched && (
                  <span className="text-muted-foreground font-normal italic text-[10px]">— did not match</span>
                )}
              </div>
              {path.conditionGroups?.map((group: any) => (
                <div key={group.groupId} className="ml-4">
                  <ConditionTable group={group} />
                </div>
              ))}
              {(!path.conditionGroups || path.conditionGroups.length === 0) && path.matched && (
                <p className="text-[10px] text-muted-foreground italic ml-4">No conditions (catch-all)</p>
              )}
              {/* Recurse into deeper splits */}
              {path.nestedSplits && <SplitTraceView splits={path.nestedSplits} depth={depth + 1} />}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function RuleEvalDetail({ rule }: { rule: any }) {
  const [expanded, setExpanded] = useState(true); // default open to show conditions
  const isMatched = rule.outcome === "MATCHED";
  const isSkipped = rule.outcome === "SKIPPED_TRIGGER_EVENT";
  const hasDetails = (rule.branches?.length > 0) || (rule.legacyConditions?.length > 0);

  return (
    <div className={cn(
      "rounded-md border",
      isMatched ? "border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/10" : ""
    )}>
      <button
        className="w-full text-left px-3 py-2 flex items-center gap-2"
        onMouseDown={() => hasDetails && setExpanded(!expanded)}
      >
        <span className={cn(
          "text-sm font-medium",
          isMatched ? "text-green-600 dark:text-green-400" : isSkipped ? "text-muted-foreground" : "text-red-500 dark:text-red-400"
        )}>
          {isMatched ? "✓" : isSkipped ? "⊘" : "✗"}
        </span>
        <span className="text-sm font-medium flex-1">{rule.ruleName}</span>
        <span className="text-xs text-muted-foreground">Priority {rule.priority}</span>
        {hasDetails && (
          expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
      </button>

      {expanded && hasDetails && (
        <div className="px-3 pb-3 space-y-3 border-t">
          {/* Legacy conditions */}
          {rule.legacyConditions?.map((group: any) => (
            <div key={group.groupId} className="mt-2">
              <ConditionTable group={group} />
            </div>
          ))}

          {/* Branches */}
          {rule.branches?.map((branch: any) => (
            <div key={branch.branchId} className="mt-2 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium">
                <span className={branch.matched ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}>
                  {branch.matched ? "✓" : "✗"}
                </span>
                <span>Branch: {branch.label}</span>
                <span className="text-muted-foreground font-normal">Priority {branch.priority}</span>
                {!branch.matched && (
                  <span className="text-muted-foreground font-normal italic">— did not match</span>
                )}
              </div>
              {branch.conditionGroups?.map((group: any) => (
                <ConditionTable key={group.groupId} group={group} />
              ))}
              {(!branch.conditionGroups || branch.conditionGroups.length === 0) && (
                <p className="text-xs text-muted-foreground italic ml-5">No conditions (catch-all branch)</p>
              )}
              {/* Nested split traces */}
              {branch.splitTraces && <SplitTraceView splits={branch.splitTraces} depth={1} />}
            </div>
          ))}

          {/* Default owner */}
          {rule.defaultOwner && (
            <div className="text-xs text-muted-foreground mt-2">
              Default owner: {rule.defaultOwner.resolved ? "✓ resolved" : "✗ not resolved"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
