"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

function buildApiParams(searchParams: URLSearchParams): string {
  const range = searchParams.get("range") || "30d";
  const objectType = searchParams.get("objectType") || "";
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
  return params.toString();
}

function RulesContent() {
  const searchParams = useSearchParams();
  const apiParams = useMemo(() => buildApiParams(searchParams), [searchParams]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-rules", apiParams],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/rules?${apiParams}`);
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const rules = data?.rules || [];

  function toggleExpand(ruleId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }

  function formatDuration(ms: number | null): string {
    if (ms === null) return "\u2014";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  return (
    <div className="mt-4">
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium w-8"></th>
              <th className="text-left p-3 font-medium">Rule Name</th>
              <th className="text-right p-3 font-medium">Total Routed</th>
              <th className="text-right p-3 font-medium">Success Rate</th>
              <th className="text-right p-3 font-medium">Unmatched</th>
              <th className="text-right p-3 font-medium">Avg Duration</th>
              <th className="text-right p-3 font-medium">P95</th>
              <th className="text-right p-3 font-medium">Paths</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Loading...</td></tr>
            )}
            {!isLoading && rules.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No rule data for this period</td></tr>
            )}
            {rules.map((rule: any) => (
              <RuleRow
                key={rule.ruleId}
                rule={rule}
                expanded={expanded.has(rule.ruleId)}
                onToggle={() => toggleExpand(rule.ruleId)}
                formatDuration={formatDuration}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RulesPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><div className="h-32 animate-pulse rounded-lg bg-muted" /></div>}>
      <RulesContent />
    </Suspense>
  );
}

function RuleRow({
  rule,
  expanded,
  onToggle,
  formatDuration,
}: {
  rule: any;
  expanded: boolean;
  onToggle: () => void;
  formatDuration: (ms: number | null) => string;
}) {
  return (
    <>
      <tr
        className="border-b hover:bg-muted/30 cursor-pointer"
        onClick={onToggle}
      >
        <td className="p-3">
          {rule.paths.length > 0 && (
            expanded
              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
              : <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </td>
        <td className="p-3 font-medium">{rule.ruleName}</td>
        <td className="p-3 text-right">{rule.total.toLocaleString()}</td>
        <td className="p-3 text-right">
          <span className={cn(
            rule.successRate >= 95 ? "text-emerald-600" :
            rule.successRate >= 85 ? "text-yellow-600" : "text-red-500"
          )}>
            {rule.successRate}%
          </span>
        </td>
        <td className="p-3 text-right text-muted-foreground">{rule.unmatchedRate}%</td>
        <td className="p-3 text-right text-muted-foreground">{formatDuration(rule.avgDurationMs)}</td>
        <td className="p-3 text-right text-muted-foreground">{formatDuration(rule.p95DurationMs)}</td>
        <td className="p-3 text-right">{rule.paths.length}</td>
      </tr>
      {expanded && rule.paths.map((path: any) => (
        <tr key={`${rule.ruleId}-${path.pathLabel}`} className="border-b bg-muted/20">
          <td className="p-3"></td>
          <td className="p-3 pl-8 text-muted-foreground">{path.pathLabel}</td>
          <td className="p-3 text-right text-muted-foreground">{path.total.toLocaleString()}</td>
          <td className="p-3 text-right text-muted-foreground">
            {rule.total > 0 ? Math.round(path.total / rule.total * 100) : 0}%
          </td>
          <td colSpan={4}></td>
        </tr>
      ))}
    </>
  );
}
