"use client";

import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

const PERIODS = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
] as const;

interface ToolStat {
  tool: string;
  category: string;
  total: number;
  errors: number;
  rateLimited: number;
  errorRate: number;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
  avgResponseSize: number | null;
}

interface TopCaller {
  tokenId: string;
  total: number;
  lastUsed: string;
}

interface AgentApiData {
  period: string;
  since: string;
  totalCalls: number;
  toolStats: ToolStat[];
  topCallers: TopCaller[];
  warningCount: number;
}

function AgentApiContent() {
  const [period, setPeriod] = useState("7d");

  const { data, isLoading } = useQuery<AgentApiData>({
    queryKey: ["analytics-agent-api", period],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/agent-api?period=${period}`);
      if (!res.ok) throw new Error("Failed to fetch agent API analytics");
      return res.json();
    },
  });

  function formatMs(ms: number | null): string {
    if (ms === null) return "\u2014";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function formatBytes(bytes: number | null): string {
    if (bytes === null) return "\u2014";
    if (bytes < 1024) return `${bytes}B`;
    return `${(bytes / 1024).toFixed(1)}KB`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agent API Analytics</h1>
        <div className="flex gap-1 rounded-lg border bg-muted/50 p-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                period === p.value
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Total Calls</p>
          <p className="text-3xl font-bold">
            {isLoading ? "\u2014" : (data?.totalCalls ?? 0).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Tools Used</p>
          <p className="text-3xl font-bold">
            {isLoading ? "\u2014" : data?.toolStats.length ?? 0}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <p className="text-sm text-muted-foreground">Warnings</p>
          <p className="text-3xl font-bold">
            {isLoading ? "\u2014" : (data?.warningCount ?? 0).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Tool Usage Table */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="border-b bg-muted/50 px-4 py-3">
          <h2 className="font-medium">Tool Usage</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left p-3 font-medium">Tool</th>
              <th className="text-left p-3 font-medium">Category</th>
              <th className="text-right p-3 font-medium">Calls</th>
              <th className="text-right p-3 font-medium">Errors</th>
              <th className="text-right p-3 font-medium">Error Rate</th>
              <th className="text-right p-3 font-medium">Avg Latency</th>
              <th className="text-right p-3 font-medium">Max Latency</th>
              <th className="text-right p-3 font-medium">Avg Response</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            )}
            {!isLoading && (!data?.toolStats || data.toolStats.length === 0) && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
                  No agent API calls in this period
                </td>
              </tr>
            )}
            {data?.toolStats.map((stat) => (
              <tr key={stat.tool} className="border-b hover:bg-muted/20">
                <td className="p-3 font-medium">{stat.tool}</td>
                <td className="p-3">
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
                      stat.category === "setup" && "bg-blue-100 text-blue-800",
                      stat.category === "operations" && "bg-green-100 text-green-800",
                      stat.category === "optimize" && "bg-purple-100 text-purple-800",
                      stat.category === "monitor" && "bg-gray-100 text-gray-800"
                    )}
                  >
                    {stat.category}
                  </span>
                </td>
                <td className="p-3 text-right">{stat.total.toLocaleString()}</td>
                <td className="p-3 text-right">
                  {stat.errors > 0 ? (
                    <span className="text-red-500">{stat.errors}</span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </td>
                <td className="p-3 text-right">
                  <span
                    className={cn(
                      stat.errorRate > 10
                        ? "text-red-500"
                        : stat.errorRate > 5
                          ? "text-yellow-600"
                          : "text-muted-foreground"
                    )}
                  >
                    {stat.errorRate}%
                  </span>
                </td>
                <td className="p-3 text-right text-muted-foreground">
                  {formatMs(stat.avgLatencyMs)}
                </td>
                <td className="p-3 text-right text-muted-foreground">
                  {formatMs(stat.maxLatencyMs)}
                </td>
                <td className="p-3 text-right text-muted-foreground">
                  {formatBytes(stat.avgResponseSize)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Top Callers */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="border-b bg-muted/50 px-4 py-3">
          <h2 className="font-medium">Top API Callers</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="text-left p-3 font-medium">Token ID</th>
              <th className="text-right p-3 font-medium">Total Calls</th>
              <th className="text-right p-3 font-medium">Last Used</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={3} className="p-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            )}
            {!isLoading && (!data?.topCallers || data.topCallers.length === 0) && (
              <tr>
                <td colSpan={3} className="p-8 text-center text-muted-foreground">
                  No callers in this period
                </td>
              </tr>
            )}
            {data?.topCallers.map((caller) => (
              <tr key={caller.tokenId} className="border-b hover:bg-muted/20">
                <td className="p-3 font-mono text-xs">
                  {caller.tokenId.slice(0, 12)}...
                </td>
                <td className="p-3 text-right">{caller.total.toLocaleString()}</td>
                <td className="p-3 text-right text-muted-foreground">
                  {new Date(caller.lastUsed).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AgentApiPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        </div>
      }
    >
      <AgentApiContent />
    </Suspense>
  );
}
