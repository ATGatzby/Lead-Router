"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Users, Percent, DollarSign, TrendingUp, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApiParams(searchParams: URLSearchParams): string {
  const range = searchParams.get("range") || "30d";
  const objectType = searchParams.get("objectType") || "";
  const nowMs = Math.floor(Date.now() / 60000) * 60000;
  const now = new Date(nowMs);
  let from: Date;
  switch (range) {
    case "today": from = new Date(now); from.setHours(0, 0, 0, 0); break;
    case "7d": from = new Date(nowMs - 7 * 86400000); break;
    case "90d": from = new Date(nowMs - 90 * 86400000); break;
    default: from = new Date(nowMs - 30 * 86400000);
  }
  const params = new URLSearchParams();
  params.set("from", from.toISOString());
  params.set("to", now.toISOString());
  if (objectType) params.set("objectType", objectType);
  return params.toString();
}

function formatCurrency(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ title, value, icon: Icon, format }: {
  title: string;
  value: number | string | null;
  icon: React.ComponentType<{ className?: string }>;
  format?: "number" | "percent" | "currency";
}) {
  const formatted = value === null ? "\u2014" :
    format === "percent" ? `${value}%` :
    format === "currency" ? `$${Number(value).toLocaleString()}` :
    Number(value).toLocaleString();
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-muted-foreground">{title}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="text-2xl font-bold">{formatted}</div>
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface SpeedBucket {
  bucket: string;
  total: number;
  converted: number;
  conversionRate: number;
}

interface RuleConversion {
  ruleId: string;
  ruleName: string;
  total: number;
  converted: number;
  conversionRate: number;
  pipeline: number;
}

interface AssigneeConversion {
  assigneeId: string;
  assigneeName: string;
  total: number;
  converted: number;
  conversionRate: number;
  pipeline: number;
}

interface ConversionsData {
  converted: number;
  total: number;
  conversionRate: number;
  pipeline: number;
  avgDeal: number;
  speedBuckets: SpeedBucket[];
  byRule: RuleConversion[];
  byAssignee: AssigneeConversion[];
}

// ── Page ─────────────────────────────────────────────────────────────────────

function ConversionsContent() {
  const searchParams = useSearchParams();
  const apiParams = useMemo(() => buildApiParams(searchParams), [searchParams]);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<ConversionsData>({
    queryKey: ["analytics-conversions", apiParams],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/conversions?${apiParams}`);
      if (!res.ok) throw new Error("Failed to load conversions");
      return res.json();
    },
  });

  const refresh = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/analytics/conversions/refresh", { method: "POST" });
      if (!res.ok) throw new Error("Failed to refresh conversions");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["analytics-conversions"] });
    },
  });

  const speedBuckets = data?.speedBuckets || [];
  const byRule = data?.byRule || [];
  const byAssignee = data?.byAssignee || [];

  if (isLoading) {
    return <div className="mt-8 text-center text-muted-foreground">Loading conversion data...</div>;
  }

  return (
    <div className="space-y-6 mt-4">
      {/* Row 1: KPI Cards + Refresh */}
      <div className="flex items-start gap-4">
        <div className="grid grid-cols-4 gap-4 flex-1">
          <KpiCard
            title="Converted Leads"
            value={data?.converted ?? null}
            icon={Users}
          />
          <KpiCard
            title="Conversion Rate"
            value={data?.conversionRate ?? null}
            icon={Percent}
            format="percent"
          />
          <KpiCard
            title="Total Pipeline"
            value={data?.pipeline ?? null}
            icon={DollarSign}
            format="currency"
          />
          <KpiCard
            title="Avg Deal Size"
            value={data?.avgDeal ?? null}
            icon={TrendingUp}
            format="currency"
          />
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className={cn(
            "inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm font-medium shadow-sm",
            "hover:bg-muted transition-colors",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "shrink-0 mt-0.5"
          )}
        >
          <RefreshCw className={cn("h-4 w-4", refresh.isPending && "animate-spin")} />
          {refresh.isPending ? "Refreshing..." : "Refresh Conversions"}
        </button>
      </div>

      {/* Row 2: Speed-to-Conversion Chart */}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h2 className="text-sm font-semibold mb-4">Speed-to-Conversion</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Conversion rate by routing speed. Faster routing = higher conversions.
        </p>
        <div className="h-64">
          {speedBuckets.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={speedBuckets} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis
                  type="number"
                  domain={[0, "dataMax"]}
                  unit="%"
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <YAxis
                  type="category"
                  dataKey="bucket"
                  width={60}
                  tick={{ fontSize: 11 }}
                  stroke="hsl(var(--muted-foreground))"
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any) => [`${v}%`, "Conversion Rate"]}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <Bar
                  dataKey="conversionRate"
                  fill="#22c55e"
                  radius={[0, 4, 4, 0]}
                  name="Conversion Rate"
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No speed-to-conversion data available
            </div>
          )}
        </div>
      </div>

      {/* Row 3: By Rule + By Assignee */}
      <div className="grid grid-cols-2 gap-4">
        {/* Conversion by Rule */}
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-sm font-semibold">Conversion by Rule</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Rule</th>
                <th className="text-right p-3 font-medium">Tracked</th>
                <th className="text-right p-3 font-medium">Converted</th>
                <th className="text-right p-3 font-medium">Conv %</th>
                <th className="text-right p-3 font-medium">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {byRule.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No conversion data by rule
                  </td>
                </tr>
              )}
              {byRule.map((rule) => (
                <tr key={rule.ruleId} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium truncate max-w-[180px]">{rule.ruleName}</td>
                  <td className="p-3 text-right text-muted-foreground">{rule.total.toLocaleString()}</td>
                  <td className="p-3 text-right">{rule.converted.toLocaleString()}</td>
                  <td className="p-3 text-right">
                    <span className={cn(
                      rule.conversionRate >= 20 ? "text-emerald-600" :
                      rule.conversionRate >= 10 ? "text-yellow-600" : "text-red-500"
                    )}>
                      {rule.conversionRate}%
                    </span>
                  </td>
                  <td className="p-3 text-right text-muted-foreground">{formatCurrency(rule.pipeline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Conversion by Assignee */}
        <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-sm font-semibold">Conversion by Assignee</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium">Assignee</th>
                <th className="text-right p-3 font-medium">Tracked</th>
                <th className="text-right p-3 font-medium">Converted</th>
                <th className="text-right p-3 font-medium">Conv %</th>
                <th className="text-right p-3 font-medium">Pipeline</th>
              </tr>
            </thead>
            <tbody>
              {byAssignee.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-muted-foreground">
                    No conversion data by assignee
                  </td>
                </tr>
              )}
              {byAssignee.map((assignee) => (
                <tr key={assignee.assigneeId} className="border-b hover:bg-muted/30">
                  <td className="p-3 font-medium truncate max-w-[180px]">{assignee.assigneeName}</td>
                  <td className="p-3 text-right text-muted-foreground">{assignee.total.toLocaleString()}</td>
                  <td className="p-3 text-right">{assignee.converted.toLocaleString()}</td>
                  <td className="p-3 text-right">
                    <span className={cn(
                      assignee.conversionRate >= 20 ? "text-emerald-600" :
                      assignee.conversionRate >= 10 ? "text-yellow-600" : "text-red-500"
                    )}>
                      {assignee.conversionRate}%
                    </span>
                  </td>
                  <td className="p-3 text-right text-muted-foreground">{formatCurrency(assignee.pipeline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ConversionsPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><div className="h-32 animate-pulse rounded-lg bg-muted" /></div>}>
      <ConversionsContent />
    </Suspense>
  );
}
