"use client";

import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from "recharts";
import {
  ThumbsUp,
  Activity,
  CheckCircle2,
  MessageSquare,
  Loader2,
  BrainCircuit,
} from "lucide-react";
import { ImprovementSuggestions } from "@/components/ai-chat/ImprovementSuggestions";

/* ── Types ──────────────────────────────────────────────── */

interface StatsResponse {
  feedbackStats: {
    positive: number;
    negative: number;
    total: number;
    score: number;
  };
  actionStats: {
    total: number;
    confirmed: number;
    previewed: number;
    failed: number;
    cancelled: number;
    byTool: Record<string, number>;
  };
  weeklyTrend: { week: string; positive: number; negative: number }[];
  recentNegative: {
    userMessage: string;
    aiResponse: string;
    feedback: string | null;
    context: string | null;
    createdAt: string;
  }[];
}

/* ── Palette ────────────────────────────────────────────── */

const VIOLET = "#8b5cf6";
const VIOLET_LIGHT = "#a78bfa";
const RED = "#ef4444";
const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const SLATE = "#64748b";

const STATUS_COLORS = [GREEN, VIOLET_LIGHT, RED, SLATE];
const TOOL_COLORS = [VIOLET, "#6366f1", "#3b82f6", "#06b6d4", "#14b8a6", AMBER, "#f97316", RED];

/* ── Stat Card ──────────────────────────────────────────── */

function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 flex items-start gap-4">
      <div className="rounded-lg bg-violet-100 dark:bg-violet-950 p-2.5 text-violet-600 dark:text-violet-400">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight mt-0.5">{value}</p>
        {sub && (
          <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

/* ── Chart Card wrapper ─────────────────────────────────── */

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────────── */

function formatWeek(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function truncate(s: string, len: number) {
  if (s.length <= len) return s;
  return s.slice(0, len) + "...";
}

/* ── Page ────────────────────────────────────────────────── */

export default function PerformancePage() {
  const { data: license } = useQuery<{ tier: string }>({
    queryKey: ["license"],
    queryFn: async () => {
      const res = await fetch("/api/license");
      if (!res.ok) throw new Error("Failed to load license");
      return res.json();
    },
  });

  const isFree = !license || license.tier === "free";

  const { data, isLoading, error } = useQuery<StatsResponse>({
    queryKey: ["ai-performance-stats"],
    queryFn: async () => {
      const res = await fetch("/api/ai/stats");
      if (!res.ok) throw new Error("Failed to fetch AI stats");
      return res.json();
    },
    staleTime: 30_000,
  });

  if (isFree) {
    return (
      <div className="relative max-w-3xl min-h-[60vh]">
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto max-w-sm text-center px-8 py-8 rounded-2xl bg-white dark:bg-gray-900 border shadow-2xl shadow-violet-500/10">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-purple-100 dark:from-violet-900 dark:to-purple-900">
              <BrainCircuit className="h-7 w-7 text-violet-600 dark:text-violet-400" />
            </div>
            <h3 className="text-lg font-semibold mb-2">AI Performance requires Pro</h3>
            <p className="text-sm text-muted-foreground leading-relaxed mb-5">
              Monitor AI assistant accuracy, feedback trends, and tool usage across your team.
            </p>
            <a
              href="https://openedgeai.tech/pricing"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 dark:from-violet-500 dark:to-purple-500 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:-translate-y-0.5 hover:shadow-xl hover:shadow-violet-500/40"
            >
              <BrainCircuit className="h-4 w-4" />
              Upgrade to Pro
            </a>
          </div>
        </div>
        <div className="pointer-events-none select-none blur-[3px] opacity-40 space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">AI Performance</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Monitor AI assistant accuracy, feedback trends, and tool usage.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-4">{[0,1,2,3].map(i => <div key={i} className="rounded-xl border bg-card h-28" />)}</div>
          <div className="grid grid-cols-3 gap-4">{[0,1,2].map(i => <div key={i} className="rounded-xl border bg-card h-64" />)}</div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            AI Performance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor AI assistant accuracy, feedback trends, and tool usage.
          </p>
        </div>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading metrics...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            AI Performance
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor AI assistant accuracy, feedback trends, and tool usage.
          </p>
        </div>
        <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
          Failed to load performance data. Make sure the AI tables are migrated.
        </div>
      </div>
    );
  }

  const { feedbackStats, actionStats, weeklyTrend, recentNegative } = data;

  const successRate =
    actionStats.total > 0
      ? Math.round(
          ((actionStats.confirmed + actionStats.previewed) /
            actionStats.total) *
            100
        )
      : 0;

  // Pie data for action status
  const statusData = [
    { name: "Confirmed", value: actionStats.confirmed },
    { name: "Preview", value: actionStats.previewed },
    { name: "Failed", value: actionStats.failed },
    { name: "Cancelled", value: actionStats.cancelled },
  ].filter((d) => d.value > 0);

  // Pie data for tool usage
  const toolData = Object.entries(actionStats.byTool)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          AI Performance
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor AI assistant accuracy, feedback trends, and tool usage.
        </p>
      </div>

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Feedback Score"
          value={`${feedbackStats.score}%`}
          sub={`${feedbackStats.positive} positive / ${feedbackStats.negative} negative`}
          icon={<ThumbsUp className="h-5 w-5" />}
        />
        <StatCard
          label="Total AI Actions"
          value={actionStats.total.toLocaleString()}
          sub={`${actionStats.confirmed} confirmed`}
          icon={<Activity className="h-5 w-5" />}
        />
        <StatCard
          label="Success Rate"
          value={`${successRate}%`}
          sub={`${actionStats.failed} failed`}
          icon={<CheckCircle2 className="h-5 w-5" />}
        />
        <StatCard
          label="Conversations"
          value={feedbackStats.total.toLocaleString()}
          sub="Total feedback entries"
          icon={<MessageSquare className="h-5 w-5" />}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Feedback Trend */}
        <ChartCard title="Feedback Trend (Last 30 Days)">
          {weeklyTrend.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
              No feedback data in the last 30 days
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={weeklyTrend}>
                <XAxis
                  dataKey="week"
                  tickFormatter={formatWeek}
                  tick={{ fontSize: 11 }}
                  stroke="currentColor"
                  className="text-muted-foreground"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  allowDecimals={false}
                  stroke="currentColor"
                  className="text-muted-foreground"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: 12,
                  }}
                  labelFormatter={(label: any) => formatWeek(String(label))}
                />
                <Bar
                  dataKey="positive"
                  name="Positive"
                  fill={GREEN}
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="negative"
                  name="Negative"
                  fill={RED}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Tool Usage */}
        <ChartCard title="Tool Usage">
          {toolData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
              No tool usage data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={toolData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {toolData.map((_, i) => (
                    <Cell
                      key={`tool-${i}`}
                      fill={TOOL_COLORS[i % TOOL_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: 12,
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  iconSize={8}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Action Status */}
        <ChartCard title="Action Status Breakdown">
          {statusData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
              No action data yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  nameKey="name"
                >
                  {statusData.map((_, i) => (
                    <Cell
                      key={`status-${i}`}
                      fill={STATUS_COLORS[i % STATUS_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: 12,
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  iconSize={8}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Recent Negative Feedback */}
      <div className="rounded-xl border bg-card p-5 space-y-4">
        <h3 className="text-sm font-semibold">Recent Negative Feedback</h3>
        {recentNegative.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No negative feedback recorded yet. This is a good sign!
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">User Message</th>
                  <th className="pb-2 pr-4 font-medium">AI Response</th>
                  <th className="pb-2 pr-4 font-medium">Feedback</th>
                  <th className="pb-2 pr-4 font-medium">Context</th>
                  <th className="pb-2 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentNegative.map((entry, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2.5 pr-4 text-xs max-w-[200px]">
                      <span className="line-clamp-2">
                        {truncate(entry.userMessage, 120)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-muted-foreground max-w-[200px]">
                      <span className="line-clamp-2">
                        {truncate(entry.aiResponse, 120)}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs max-w-[180px]">
                      {entry.feedback ? (
                        <span className="text-red-600 dark:text-red-400 line-clamp-2">
                          {entry.feedback}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          No comment
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-xs">
                      {entry.context ? (
                        <span className="inline-block rounded bg-violet-100 dark:bg-violet-950 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                          {entry.context}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(entry.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Improvement Suggestions */}
      <ImprovementSuggestions />
    </div>
  );
}
