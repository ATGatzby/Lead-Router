"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, Legend
} from "recharts";
import { TrendingUp, TrendingDown, Minus, Zap, Target, Clock, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

// Helper to build API query string from search params
function buildApiParams(searchParams: URLSearchParams): string {
  const range = searchParams.get("range") || "30d";
  const objectType = searchParams.get("objectType") || "";
  const ruleId = searchParams.get("ruleId") || "";
  const teamId = searchParams.get("teamId") || "";
  const assigneeId = searchParams.get("assigneeId") || "";

  // Convert range preset to from/to dates
  // Round to the nearest minute to avoid infinite re-fetch loops
  const nowMs = Math.floor(Date.now() / 60000) * 60000;
  const now = new Date(nowMs);
  let from: Date;
  switch (range) {
    case "today": from = new Date(now); from.setHours(0,0,0,0); break;
    case "7d": from = new Date(nowMs - 7 * 86400000); break;
    case "90d": from = new Date(nowMs - 90 * 86400000); break;
    default: from = new Date(nowMs - 30 * 86400000);
  }

  const params = new URLSearchParams();
  params.set("from", from.toISOString());
  params.set("to", now.toISOString());
  if (objectType) params.set("objectType", objectType);
  if (ruleId) params.set("ruleId", ruleId);
  if (teamId) params.set("teamId", teamId);
  if (assigneeId) params.set("assigneeId", assigneeId);
  return params.toString();
}

// ── KPI Card Component ────────────────────────────────────────────────────
function KpiCard({
  title, value, delta, icon: Icon, format = "number"
}: {
  title: string;
  value: number | string | null;
  delta: number | null;
  icon: React.ComponentType<{ className?: string }>;
  format?: "number" | "percent" | "seconds" | "currency";
}) {
  const formatted = value === null ? "\u2014" :
    format === "percent" ? `${value}%` :
    format === "seconds" ? `${value}s` :
    format === "currency" ? `$${Number(value).toLocaleString()}` :
    Number(value).toLocaleString();

  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{title}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-bold">{formatted}</div>
      {delta !== null && delta !== undefined && (
        <div className={cn(
          "flex items-center gap-1 text-xs mt-1",
          delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-500" : "text-muted-foreground"
        )}>
          {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
          <span>{delta > 0 ? "+" : ""}{Math.round(delta * 10) / 10}% vs prior period</span>
        </div>
      )}
    </div>
  );
}

// ── Status colors ─────────────────────────────────────────────────────────
const STATUS_COLORS = {
  success: "#22c55e",
  failed: "#ef4444",
  unmatched: "#eab308",
  merged: "#a855f7",
};

const DONUT_COLORS = ["#22c55e", "#ef4444", "#eab308", "#a855f7"];

function OverviewContent() {
  const searchParams = useSearchParams();
  const apiParams = useMemo(() => buildApiParams(searchParams), [searchParams]);
  const [granularity, setGranularity] = useState("day");
  const [groupBy, setGroupBy] = useState("status");

  // Fetch overview KPIs
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["analytics-overview", apiParams],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/overview?${apiParams}`);
      if (!res.ok) throw new Error("Failed to load overview");
      return res.json();
    },
  });

  // Fetch volume time series
  const { data: volume, isLoading: volumeLoading } = useQuery({
    queryKey: ["analytics-volume", apiParams, granularity, groupBy],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/volume?${apiParams}&granularity=${granularity}&groupBy=${groupBy}`);
      if (!res.ok) throw new Error("Failed to load volume");
      return res.json();
    },
  });

  // Fetch rules for top rules table
  const { data: rulesData } = useQuery({
    queryKey: ["analytics-rules", apiParams],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/rules?${apiParams}`);
      if (!res.ok) throw new Error("Failed to load rules");
      return res.json();
    },
  });

  const topRules = rulesData?.rules?.slice(0, 5) || [];
  const maxRuleVolume = topRules.length > 0 ? Math.max(...topRules.map((r: any) => r.total)) : 1;

  // Format volume chart data
  const chartData = (volume?.series || []).map((d: any) => ({
    ...d,
    date: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  }));

  // Donut data
  const donutData = overview ? [
    { name: "Success", value: overview.statusBreakdown.success },
    { name: "Failed", value: overview.statusBreakdown.failed },
    { name: "Unmatched", value: overview.statusBreakdown.unmatched },
    { name: "Merged", value: overview.statusBreakdown.merged },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="space-y-6 mt-4">
      {/* Row 1: KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        <KpiCard
          title="Total Routed"
          value={overview?.totalRouted ?? null}
          delta={overview?.totalRoutedDelta ?? null}
          icon={BarChart3}
        />
        <KpiCard
          title="Success Rate"
          value={overview?.successRate ?? null}
          delta={overview?.successRateDelta ?? null}
          icon={Target}
          format="percent"
        />
        <KpiCard
          title="Avg Speed-to-Lead"
          value={overview?.avgSpeedSeconds ?? null}
          delta={overview?.avgSpeedDelta ?? null}
          icon={Clock}
          format="seconds"
        />
        <KpiCard
          title="Conversion Rate"
          value={overview?.conversionRate ?? null}
          delta={overview?.conversionRateDelta ?? null}
          icon={Zap}
          format="percent"
        />
      </div>

      {/* Row 2: Volume Chart */}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Records Routed Over Time</h2>
          <div className="flex items-center gap-2">
            {/* Granularity toggle */}
            <div className="flex rounded-md border text-xs">
              {(["day", "week", "month"] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={cn(
                    "px-2 py-1 border-r last:border-r-0 capitalize",
                    granularity === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
            {/* Group by toggle */}
            <select
              value={groupBy}
              onChange={e => setGroupBy(e.target.value)}
              className="h-7 rounded-md border bg-background px-2 text-xs"
            >
              <option value="status">By Status</option>
              <option value="objectType">By Object</option>
              <option value="rule">By Rule</option>
              <option value="team">By Team</option>
            </select>
          </div>
        </div>
        <div className="h-72">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              {groupBy === "status" ? (
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid hsl(var(--border))" }} />
                  <Area type="monotone" dataKey="success" stackId="1" fill={STATUS_COLORS.success} stroke={STATUS_COLORS.success} fillOpacity={0.6} name="Success" />
                  <Area type="monotone" dataKey="failed" stackId="1" fill={STATUS_COLORS.failed} stroke={STATUS_COLORS.failed} fillOpacity={0.6} name="Failed" />
                  <Area type="monotone" dataKey="unmatched" stackId="1" fill={STATUS_COLORS.unmatched} stroke={STATUS_COLORS.unmatched} fillOpacity={0.6} name="Unmatched" />
                  <Area type="monotone" dataKey="merged" stackId="1" fill={STATUS_COLORS.merged} stroke={STATUS_COLORS.merged} fillOpacity={0.6} name="Merged" />
                  <Legend />
                </AreaChart>
              ) : (
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {volumeLoading ? "Loading..." : "No data for selected period"}
            </div>
          )}
        </div>
      </div>

      {/* Row 3: Top Rules + Status Donut */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top Rules */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold mb-3">Top Rules</h2>
          <div className="space-y-3">
            {topRules.length === 0 && (
              <p className="text-sm text-muted-foreground">No rule data yet</p>
            )}
            {topRules.map((rule: any) => (
              <div key={rule.ruleId} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium truncate">{rule.ruleName}</span>
                  <span className="text-muted-foreground ml-2 shrink-0">
                    {rule.total.toLocaleString()} &middot; {rule.successRate}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${(rule.total / maxRuleVolume) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Status Donut */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h2 className="text-sm font-semibold mb-3">Status Breakdown</h2>
          {donutData.length > 0 ? (
            <div className="flex items-center justify-center">
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie
                    data={donutData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    dataKey="value"
                    label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {donutData.map((_, i) => (
                      <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
              No data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><div className="h-32 animate-pulse rounded-lg bg-muted" /></div>}>
      <OverviewContent />
    </Suspense>
  );
}
