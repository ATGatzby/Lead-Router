"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface RepStat {
  name: string;
  LEAD: number;
  CONTACT: number;
  ACCOUNT: number;
  total: number;
}

interface StatsResponse {
  stats: RepStat[];
  from: string;
  to: string;
  period: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type Period = "today" | "week" | "month" | "custom";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
];

// ─── Main ────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [period, setPeriod] = useState<Period>("month");

  const query = useQuery<StatsResponse>({
    queryKey: ["routing-stats", period],
    queryFn: async () => {
      const res = await fetch(`/api/routing-logs/stats?period=${period}`);
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
  });

  const stats = query.data?.stats ?? [];
  const maxTotal = stats[0]?.total ?? 1;

  const fmtDateRange = () => {
    if (!query.data) return "";
    const from = new Date(query.data.from).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
    const to = new Date(query.data.to).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
    return `${from} – ${to}`;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Assignment Stats</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {query.data ? fmtDateRange() : "Per-rep routing distribution."}
          </p>
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-1 rounded-lg border p-0.5 bg-muted/30">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "px-3 py-1.5 text-sm rounded-md transition-colors",
                period === p.value
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading / Error */}
      {query.isLoading && (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading…</div>
      )}
      {query.isError && (
        <div className="text-center py-16 text-destructive text-sm">Failed to load stats.</div>
      )}

      {/* Empty */}
      {query.isSuccess && stats.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <BarChart3 className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-muted-foreground text-sm">No successful routings in this period.</p>
        </div>
      )}

      {/* Stats table */}
      {stats.length > 0 && (
        <div className="rounded-xl border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1fr_80px_80px_80px_80px] items-center gap-4 px-4 py-2.5 bg-muted/40 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>Rep</span>
            <span className="text-right">Leads</span>
            <span className="text-right">Contacts</span>
            <span className="text-right">Accounts</span>
            <span className="text-right">Total</span>
          </div>

          {stats.map((rep, idx) => (
            <div
              key={rep.name}
              className="grid grid-cols-[1fr_80px_80px_80px_80px] items-center gap-4 px-4 py-3 border-b last:border-b-0 bg-card"
            >
              {/* Rep name + bar */}
              <div className="min-w-0">
                <div className="text-sm font-medium mb-1">{rep.name}</div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/70 transition-all"
                    style={{ width: `${(rep.total / maxTotal) * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-sm tabular-nums text-right text-muted-foreground">{rep.LEAD}</span>
              <span className="text-sm tabular-nums text-right text-muted-foreground">{rep.CONTACT}</span>
              <span className="text-sm tabular-nums text-right text-muted-foreground">{rep.ACCOUNT}</span>
              <span className="text-sm tabular-nums text-right font-semibold">{rep.total}</span>
            </div>
          ))}

          {/* Totals row */}
          <div className="grid grid-cols-[1fr_80px_80px_80px_80px] items-center gap-4 px-4 py-2.5 bg-muted/20 text-xs font-medium text-muted-foreground uppercase tracking-wider border-t">
            <span>Total</span>
            <span className="text-right tabular-nums">{stats.reduce((s, r) => s + r.LEAD, 0)}</span>
            <span className="text-right tabular-nums">{stats.reduce((s, r) => s + r.CONTACT, 0)}</span>
            <span className="text-right tabular-nums">{stats.reduce((s, r) => s + r.ACCOUNT, 0)}</span>
            <span className="text-right tabular-nums">{stats.reduce((s, r) => s + r.total, 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
