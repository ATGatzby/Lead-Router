"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Activity,
  ChevronDown,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

interface HealthData {
  cooldownSkips: { last1h: number; last24h: number; last7d: number };
  stampSkips: { last1h: number; last24h: number; last7d: number };
  recursiveBounces: { last1h: number; last24h: number; last7d: number };
  recentEvents: {
    crmRecordId: string;
    objectType: string;
    count: number;
    firstSeen: string;
    lastSeen: string;
    ruleName: string | null;
    status: string;
  }[];
}

function StatusBanner({ data }: { data: HealthData }) {
  const bounces1h = data.recursiveBounces.last1h;
  const isRed = bounces1h > 0;
  const isAmber = !isRed && data.cooldownSkips.last1h > 5;
  const isGreen = !isRed && !isAmber;

  return (
    <div
      className={cn(
        "rounded-lg border p-4 flex items-center gap-3",
        isRed && "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-900",
        isAmber && "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900",
        isGreen && "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900"
      )}
    >
      {isRed && (
        <>
          <div className="relative">
            <ShieldAlert className="h-6 w-6 text-red-600 dark:text-red-400" />
            <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-red-500 dark:bg-red-400 animate-pulse" />
          </div>
          <div>
            <p className="font-semibold text-red-800 dark:text-red-300">
              {bounces1h} recursive routing event{bounces1h !== 1 ? "s" : ""} detected in the last hour
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 mt-0.5">
              Records are being routed multiple times in quick succession. Check your UPDATE rules for overly broad conditions.
            </p>
          </div>
        </>
      )}
      {isAmber && (
        <>
          <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-300">
              Safeguards active — {data.cooldownSkips.last1h} cooldown skips in the last hour
            </p>
            <p className="text-sm text-amber-600 dark:text-amber-400 mt-0.5">
              The engine cooldown (Layer 3) is actively preventing recursive routing. This is expected behavior.
            </p>
          </div>
        </>
      )}
      {isGreen && (
        <>
          <ShieldCheck className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-semibold text-emerald-800 dark:text-emerald-300">
              All clear — no recursive events detected
            </p>
            <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-0.5">
              All three safeguard layers are functioning normally.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  title,
  layer,
  values,
  variant = "info",
}: {
  title: string;
  layer: string;
  values: { last1h: number; last24h: number; last7d: number };
  variant?: "info" | "warning";
}) {
  const isWarning = variant === "warning" && values.last24h > 0;

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        isWarning
          ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
          : "border-border bg-card"
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          {layer}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "text-3xl font-bold tabular-nums font-display",
            isWarning ? "text-red-600 dark:text-red-400" : "text-foreground"
          )}
        >
          {values.last24h}
        </span>
        <span className="text-sm text-muted-foreground">last 24h</span>
      </div>
      <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
        <span>1h: <span className="font-medium text-foreground">{values.last1h}</span></span>
        <span>7d: <span className="font-medium text-foreground">{values.last7d}</span></span>
      </div>
    </div>
  );
}

function statusBadge(status: string) {
  switch (status) {
    case "COOLDOWN_SKIPPED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-xs font-medium">
          <ShieldCheck className="h-3 w-3" /> Blocked by Cooldown
        </span>
      );
    case "STAMP_SKIPPED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-xs font-medium">
          <ShieldCheck className="h-3 w-3" /> Blocked by Stamp
        </span>
      );
    case "BREACHED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 px-2 py-0.5 text-xs font-medium">
          <XCircle className="h-3 w-3" /> Breached — Routed Twice
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2 py-0.5 text-xs font-medium">
          {status}
        </span>
      );
  }
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function timeBetween(first: string, last: string) {
  const diff = new Date(last).getTime() - new Date(first).getTime();
  if (diff < 1000) return "<1s";
  return `${(diff / 1000).toFixed(1)}s`;
}

function EventsTable({ events }: { events: HealthData["recentEvents"] }) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No recursive events in the last 24 hours</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground uppercase tracking-wide">
            <th className="py-2 px-3 font-medium">Record ID</th>
            <th className="py-2 px-3 font-medium">Object</th>
            <th className="py-2 px-3 font-medium">Rule</th>
            <th className="py-2 px-3 font-medium">Time</th>
            <th className="py-2 px-3 font-medium">Duration</th>
            <th className="py-2 px-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, i) => {
            const isBreached = event.status === "BREACHED";
            return (
              <tr
                key={`${event.crmRecordId}-${i}`}
                className={cn(
                  "border-b last:border-b-0 transition-colors",
                  isBreached
                    ? "bg-red-50/50 dark:bg-red-950/10"
                    : "hover:bg-muted/50"
                )}
              >
                <td className="py-2.5 px-3 font-mono text-xs">
                  {event.crmRecordId}
                </td>
                <td className="py-2.5 px-3">
                  <span className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
                    {event.objectType}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-muted-foreground">
                  {event.ruleName || "—"}
                </td>
                <td className="py-2.5 px-3 text-muted-foreground text-xs">
                  {timeAgo(event.lastSeen)}
                </td>
                <td className="py-2.5 px-3 font-mono text-xs">
                  {event.count > 1 ? timeBetween(event.firstSeen, event.lastSeen) : "—"}
                </td>
                <td className="py-2.5 px-3">{statusBadge(event.status)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SafeguardCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Layer 1 */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
            <span className="text-xs font-bold text-blue-700 dark:text-blue-300">L1</span>
          </div>
          <div>
            <p className="text-sm font-semibold">Smart Flag Sync</p>
            <p className="text-xs text-muted-foreground">Disable triggers when no rules exist</p>
          </div>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
            <span>Flags sync on rule create/update/delete</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
            <span>Flags sync on SFDC deploy</span>
          </div>
        </div>
      </div>

      {/* Layer 2 */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-full bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
            <span className="text-xs font-bold text-violet-700 dark:text-violet-300">L2</span>
          </div>
          <div>
            <p className="text-sm font-semibold">Routing Action Stamp</p>
            <p className="text-xs text-muted-foreground">Field-level recursion guard</p>
          </div>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
            <span>Routing_Action__c field on Lead/Contact/Account</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
            <span>Engine stamps on every assignment</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
            <span>Triggers skip engine-stamped updates</span>
          </div>
        </div>
      </div>

      {/* Layer 3 */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <span className="text-xs font-bold text-amber-700 dark:text-amber-300">L3</span>
          </div>
          <div>
            <p className="text-sm font-semibold">Engine Cooldown</p>
            <p className="text-xs text-muted-foreground">Redis-based 30s dedup</p>
          </div>
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
            <span>Redis cooldown key per record</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span>TTL: 30 seconds</span>
          </div>
          <div className="flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
            <span>UPDATE events checked before processing</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TriggerHealthPage() {
  const { data, isLoading, error } = useQuery<HealthData>({
    queryKey: ["trigger-health"],
    queryFn: () => fetch("/api/health/recursive").then((r) => r.json()),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-display">Trigger Health</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Monitor safeguard layers that prevent recursive trigger loops
        </p>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">
          <Activity className="h-6 w-6 mx-auto mb-2 animate-pulse" />
          <p className="text-sm">Loading health data...</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30 p-4">
          <p className="text-sm text-red-700 dark:text-red-400">
            Failed to load health data. The API may be unavailable.
          </p>
        </div>
      )}

      {data && (
        <>
          {/* Health Status Banner */}
          <StatusBanner data={data} />

          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard
              title="Cooldown Skips"
              layer="Layer 3"
              values={data.cooldownSkips}
              variant="info"
            />
            <KpiCard
              title="Stamp Skips"
              layer="Layer 2"
              values={data.stampSkips}
              variant="info"
            />
            <KpiCard
              title="Recursive Bounces"
              layer="Breached"
              values={data.recursiveBounces}
              variant="warning"
            />
          </div>

          {/* Safeguard Layer Status */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Safeguard Layers</h2>
            <SafeguardCards />
          </div>

          {/* Recent Events Table */}
          <div>
            <h2 className="text-lg font-semibold mb-3">Recent Events (24h)</h2>
            <div className="rounded-lg border">
              <EventsTable events={data.recentEvents} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
