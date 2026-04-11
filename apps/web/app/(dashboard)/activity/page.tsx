"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, ExternalLink, History, Braces, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody } from "@/components/ui/sheet";
import { Popover } from "radix-ui";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TableSkeleton } from "@/components/skeletons/table-skeleton";
import { TraceDetail, NoTraceDetail } from "@/components/record-journey/JourneyStep";

// ─── Types ─────────────────────────────────────────────────────────────────

interface RoutingLog {
  id: string;
  crmRecordId: string;
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  eventType: string;
  ruleId: string | null;
  ruleName: string | null;
  pathLabel: string | null;
  assigneeName: string | null;
  assignmentType: string | null;
  status: "SUCCESS" | "FAILED" | "UNMATCHED" | "RETRY" | "MERGED" | "COOLDOWN_SKIPPED" | "STAMP_SKIPPED";
  errorMessage: string | null;
  retryCount: number;
  recordSnapshot: Record<string, unknown> | null;
  decisionTrace: unknown;
  routingDurationMs: number | null;
  teamName: string | null;
  createdAt: string;
}

interface LogsResponse {
  logs: RoutingLog[];
  total: number;
  page: number;
  pageCount: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function RecordSnapshotPopover({ snapshot }: { snapshot: Record<string, unknown> }) {
  // Filter out null/blank values for a cleaner view
  const entries = Object.entries(snapshot).filter(([, v]) => v !== null && v !== "" && v !== false);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          title="View record fields"
        >
          <Braces className="h-3 w-3" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50 w-80 rounded-lg border bg-popover shadow-md outline-none"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Record Fields</span>
            <Popover.Close className="text-muted-foreground hover:text-foreground">
              <span className="text-xs">✕</span>
            </Popover.Close>
          </div>
          <div className="max-h-72 overflow-y-auto p-2 space-y-0.5">
            {entries.map(([key, val]) => (
              <div key={key} className="flex gap-2 px-1 py-0.5 rounded hover:bg-muted/50 text-xs">
                <span className="text-muted-foreground font-mono shrink-0 w-36 truncate" title={key}>{key}</span>
                <span className="font-mono text-foreground truncate" title={String(val)}>{String(val)}</span>
              </div>
            ))}
            {entries.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">No fields captured</p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const ANTI_RECURSION_TOOLTIP = "This event was blocked by the anti-recursion safeguard. The routing engine detected this record was recently routed.";

function StatusBadge({ status, hasRule }: { status: RoutingLog["status"]; hasRule?: boolean }) {
  const cfg: Record<string, string> = {
    SUCCESS: "bg-green-50 text-green-700 border-green-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-800",
    FAILED: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-400 dark:border-red-800",
    UNMATCHED: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-400 dark:border-yellow-800",
    RETRY: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-400 dark:border-blue-800",
    MERGED: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/50 dark:text-purple-400 dark:border-purple-800",
    COOLDOWN_SKIPPED: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800",
    STAMP_SKIPPED: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-800",
  };
  const label: Record<string, string> = {
    SUCCESS: "Success",
    FAILED: "Failed",
    UNMATCHED: hasRule ? "No Assignment Set Up" : "No Matching Rule",
    RETRY: "Retry",
    MERGED: "Merged",
    COOLDOWN_SKIPPED: "Cooldown Skip",
    STAMP_SKIPPED: "Stamp Skip",
  };

  const isAntiRecursion = status === "COOLDOWN_SKIPPED" || status === "STAMP_SKIPPED";

  const badge = (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium", cfg[status])}>
      {isAntiRecursion && <AlertTriangle className="h-3 w-3" />}
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label[status] ?? status}
    </span>
  );

  if (isAntiRecursion) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{badge}</TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            {ANTI_RECURSION_TOOLTIP}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return badge;
}

/** Detect records that appear 2+ times within 60 seconds (both SUCCESS), indicating a recursive bounce. */
function buildRecursiveSet(logs: RoutingLog[]): Set<string> {
  const ids = new Set<string>();
  const byRecord = new Map<string, number[]>();
  for (const log of logs) {
    if (log.status !== "SUCCESS") continue;
    const ts = new Date(log.createdAt).getTime();
    const existing = byRecord.get(log.crmRecordId);
    if (existing) {
      existing.push(ts);
    } else {
      byRecord.set(log.crmRecordId, [ts]);
    }
  }
  for (const [recordId, timestamps] of byRecord) {
    if (timestamps.length < 2) continue;
    timestamps.sort((a, b) => a - b);
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] - timestamps[i - 1] <= 60_000) {
        ids.add(recordId);
        break;
      }
    }
  }
  return ids;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildQuery(filters: Record<string, string>, page: number) {
  const p = new URLSearchParams();
  p.set("page", String(page));
  p.set("limit", "50");
  for (const [k, v] of Object.entries(filters)) {
    if (v && v !== "ALL") p.set(k, v);
  }
  return p.toString();
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const [selectedLog, setSelectedLog] = useState<RoutingLog | null>(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    object: "ALL",
    status: "ALL",
    ruleId: "ALL",
    teamId: "ALL",
    assignee: "",
  });

  const query = useQuery<LogsResponse>({
    queryKey: ["routing-logs", filters, page],
    queryFn: async () => {
      const res = await fetch(`/api/routing-logs?${buildQuery(filters, page)}`);
      if (!res.ok) throw new Error("Failed to load logs");
      return res.json();
    },
  });

  const { data: rules } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["rules-for-filter"],
    queryFn: async () => {
      const res = await fetch("/api/rules");
      if (!res.ok) throw new Error("Failed to load rules");
      const data = await res.json();
      return Array.isArray(data) ? data : data.rules ?? [];
    },
  });

  const { data: teams } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["teams-for-filter"],
    queryFn: async () => {
      const res = await fetch("/api/teams");
      if (!res.ok) throw new Error("Failed to load teams");
      const data = await res.json();
      return Array.isArray(data) ? data : data.teams ?? [];
    },
  });

  const logs = query.data?.logs ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = query.data?.pageCount ?? 1;
  const recursiveIds = useMemo(() => buildRecursiveSet(logs), [logs]);

  const setFilter = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const handleExport = () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v && v !== "ALL") p.set(k, v);
    }
    window.open(`/api/routing-logs/export?${p.toString()}`, "_blank");
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold font-display">Routing History</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Every routing decision made by the engine.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilter("from", e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            placeholder="From"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilter("to", e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
            placeholder="To"
          />
          <Select value={filters.object} onValueChange={(v) => setFilter("object", v)}>
            <SelectTrigger className="h-8 w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Objects</SelectItem>
              <SelectItem value="LEAD">Lead</SelectItem>
              <SelectItem value="CONTACT">Contact</SelectItem>
              <SelectItem value="ACCOUNT">Account</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.status} onValueChange={(v) => setFilter("status", v)}>
            <SelectTrigger className="h-8 w-36 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Statuses</SelectItem>
              <SelectItem value="SUCCESS">Success</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
              <SelectItem value="UNMATCHED">Unmatched</SelectItem>
              <SelectItem value="RETRY">Retry</SelectItem>
              <SelectItem value="MERGED">Merged</SelectItem>
              <SelectItem value="COOLDOWN_SKIPPED">Cooldown Skip</SelectItem>
              <SelectItem value="STAMP_SKIPPED">Stamp Skip</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.ruleId} onValueChange={(v) => setFilter("ruleId", v)}>
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue placeholder="All Routes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Routes</SelectItem>
              {rules?.map((rule) => (
                <SelectItem key={rule.id} value={rule.id}>{rule.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filters.teamId} onValueChange={(v) => setFilter("teamId", v)}>
            <SelectTrigger className="h-8 w-44 text-sm">
              <SelectValue placeholder="All Teams" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Teams</SelectItem>
              {teams?.map((team) => (
                <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-8 w-44 text-sm"
            placeholder="Search assignee…"
            value={filters.assignee}
            onChange={(e) => setFilter("assignee", e.target.value)}
          />
        </div>
      </div>

      {/* Loading / Error */}
      {query.isLoading && (
        <TableSkeleton rows={10} columns={7} />
      )}
      {query.isError && (
        <div className="text-center py-16 text-destructive text-sm">Failed to load history.</div>
      )}

      {/* Empty */}
      {query.isSuccess && logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="h-20 w-20 rounded-full bg-muted/50 flex items-center justify-center">
            <History className="h-10 w-10 text-muted-foreground/30" />
          </div>
          <p className="text-muted-foreground text-sm">No routing events found.</p>
          <p className="text-xs text-muted-foreground">Routing events will appear here once your rules start processing records.</p>
        </div>
      )}

      {/* Table */}
      {logs.length > 0 && (
        <div className="rounded-xl border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1.6fr_90px_90px_1.4fr_1.4fr_110px_110px] items-center gap-3 px-4 py-2.5 bg-muted/40 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>Record ID</span>
            <span>Object</span>
            <span>Event</span>
            <span>Rule</span>
            <span>Assignee</span>
            <span>Time</span>
            <span>Status</span>
          </div>

          {logs.map((log) => (
            <div
              key={log.id}
              className="grid grid-cols-[1.6fr_90px_90px_1.4fr_1.4fr_110px_110px] items-center gap-3 px-4 py-3 border-b last:border-b-0 bg-card hover:bg-muted/20 transition-colors cursor-pointer"
              onMouseDown={() => setSelectedLog(log)}
            >
              {/* Record ID */}
              <div className="flex items-center gap-1.5 min-w-0">
                {recursiveIds.has(log.crmRecordId) && log.status === "SUCCESS" && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="shrink-0 text-amber-500 dark:text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        Possible recursive routing: this record was routed multiple times within 60 seconds.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <span className="font-mono text-xs truncate">{log.crmRecordId}</span>
                {log.recordSnapshot && <RecordSnapshotPopover snapshot={log.recordSnapshot} />}
                <a
                  href={`https://salesforce.com/${log.crmRecordId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              {/* Object */}
              <span className="text-sm text-muted-foreground capitalize">
                {log.objectType.charAt(0) + log.objectType.slice(1).toLowerCase()}
              </span>

              {/* Event */}
              <span className="text-sm text-muted-foreground capitalize">
                {log.eventType.charAt(0) + log.eventType.slice(1).toLowerCase()}
              </span>

              {/* Rule */}
              <div className="min-w-0">
                <span className="text-sm truncate block">
                  {log.pathLabel ?? log.ruleName ?? <em className="text-muted-foreground">No match</em>}
                </span>
              </div>

              {/* Assignee */}
              <div className="min-w-0">
                <div className="text-sm truncate">{log.assigneeName ?? "—"}</div>
                {log.assignmentType && (
                  <div className="text-xs text-muted-foreground capitalize">
                    {log.assignmentType === "ROUND_ROBIN" ? "Round Robin" : log.assignmentType.toLowerCase()}
                  </div>
                )}
              </div>

              {/* Time */}
              <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtTime(log.createdAt)}</span>

              {/* Status */}
              <StatusBadge status={log.status} hasRule={!!log.ruleId} />
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, total)} of {total.toLocaleString()} events
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </Button>
            <span className="px-2">Page {page} of {pageCount}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page === pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      )}

      {/* Detail Side Panel */}
      <Sheet open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <SheetContent side="right" className="sm:max-w-xl w-full">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <span className="font-mono text-sm">{selectedLog?.crmRecordId}</span>
              <a
                href={`https://salesforce.com/${selectedLog?.crmRecordId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </SheetTitle>
            <SheetDescription>
              {selectedLog?.ruleName ?? "No rule matched"} · {
                selectedLog?.status === "UNMATCHED"
                  ? (selectedLog.ruleId ? "No assignment set up" : "No matching rule")
                  : selectedLog?.status?.toLowerCase()
              }
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            {selectedLog && (() => {
              const entry = {
                id: selectedLog.id,
                eventType: selectedLog.eventType,
                status: selectedLog.status,
                ruleName: selectedLog.ruleName,
                pathLabel: selectedLog.pathLabel,
                assigneeId: null,
                assigneeName: selectedLog.assigneeName,
                assignmentType: selectedLog.assignmentType,
                teamName: selectedLog.teamName ?? null,
                routingDurationMs: selectedLog.routingDurationMs ?? null,
                decisionTrace: selectedLog.decisionTrace,
                createdAt: selectedLog.createdAt,
              };
              return selectedLog.decisionTrace
                ? <TraceDetail trace={selectedLog.decisionTrace} entry={entry} />
                : <NoTraceDetail entry={entry} />;
            })()}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
