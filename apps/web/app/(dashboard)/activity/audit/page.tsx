"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ClipboardList } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeState: unknown;
  afterState: unknown;
  createdAt: string;
}

interface AuditResponse {
  logs: AuditLog[];
  total: number;
  page: number;
  pageCount: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function humanAction(action: string): string {
  return action
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const ENTITY_TYPES = ["User", "RoutingRule", "RoundRobinTeam", "TeamMember"];

// ─── Diff Row ────────────────────────────────────────────────────────────────

function JsonDiff({ before, after }: { before: unknown; after: unknown }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
      <div>
        <p className="font-medium text-muted-foreground mb-1">Before</p>
        <pre className="bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {before ? JSON.stringify(before, null, 2) : "—"}
        </pre>
      </div>
      <div>
        <p className="font-medium text-muted-foreground mb-1">After</p>
        <pre className="bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {after ? JSON.stringify(after, null, 2) : "—"}
        </pre>
      </div>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    entityType: "ALL",
    action: "",
  });

  const query = useQuery<AuditResponse>({
    queryKey: ["audit-logs", filters, page],
    queryFn: async () => {
      const p = new URLSearchParams({ page: String(page), limit: "50" });
      if (filters.from) p.set("from", filters.from);
      if (filters.to) p.set("to", filters.to);
      if (filters.entityType !== "ALL") p.set("entityType", filters.entityType);
      if (filters.action) p.set("action", filters.action);
      const res = await fetch(`/api/audit-logs?${p.toString()}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const logs = query.data?.logs ?? [];
  const total = query.data?.total ?? 0;
  const pageCount = query.data?.pageCount ?? 1;

  const setFilter = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Config Audit Log</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          All configuration changes made by admins.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilter("from", e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilter("to", e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm text-foreground"
        />
        <Select value={filters.entityType} onValueChange={(v) => setFilter("entityType", v)}>
          <SelectTrigger className="h-8 w-40 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            {ENTITY_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-8 w-44 text-sm"
          placeholder="Search action…"
          value={filters.action}
          onChange={(e) => setFilter("action", e.target.value)}
        />
      </div>

      {/* Loading / Error */}
      {query.isLoading && (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading…</div>
      )}
      {query.isError && (
        <div className="text-center py-16 text-destructive text-sm">Failed to load audit log.</div>
      )}

      {/* Empty */}
      {query.isSuccess && logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <ClipboardList className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">No audit entries found.</p>
        </div>
      )}

      {/* Table */}
      {logs.length > 0 && (
        <div className="rounded-xl border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[24px_140px_1.2fr_2fr_1.2fr] items-center gap-3 px-4 py-2.5 bg-muted/40 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span />
            <span>Date / Time</span>
            <span>Actor</span>
            <span>Action</span>
            <span>Entity</span>
          </div>

          {logs.map((log) => {
            const isExpanded = expanded.has(log.id);
            const hasDiff = log.beforeState != null || log.afterState != null;
            return (
              <div
                key={log.id}
                className={cn(
                  "border-b last:border-b-0 bg-card",
                  isExpanded && "bg-muted/10"
                )}
              >
                <button
                  onClick={() => hasDiff && toggleExpanded(log.id)}
                  className={cn(
                    "w-full grid grid-cols-[24px_140px_1.2fr_2fr_1.2fr] items-center gap-3 px-4 py-3 text-left transition-colors",
                    hasDiff ? "hover:bg-muted/20 cursor-pointer" : "cursor-default"
                  )}
                >
                  {/* Expand icon */}
                  <span className="text-muted-foreground/50">
                    {hasDiff ? (
                      isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
                    ) : null}
                  </span>

                  {/* Time */}
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{fmtDateTime(log.createdAt)}</span>

                  {/* Actor */}
                  <span className="text-sm font-medium truncate">{log.actorName}</span>

                  {/* Action */}
                  <span className="text-sm text-muted-foreground">{humanAction(log.action)}</span>

                  {/* Entity */}
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground">{log.entityType}</div>
                    <div className="text-xs font-mono text-muted-foreground/60 truncate">{log.entityId}</div>
                  </div>
                </button>

                {/* Expanded diff */}
                {isExpanded && hasDiff && (
                  <div className="px-10 pb-4">
                    <JsonDiff before={log.beforeState} after={log.afterState} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, total)} of {total.toLocaleString()} entries
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </Button>
            <span className="px-2">Page {page} of {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)}>
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
