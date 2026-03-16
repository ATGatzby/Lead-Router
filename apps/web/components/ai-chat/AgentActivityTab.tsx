"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Eye,
  Loader2,
  Trash2,
  Plus,
  RefreshCw,
  UserCheck,
  ChevronDown,
  ChevronRight,
  BrainCircuit,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AgentLogEntry {
  id: string;
  context: string;
  toolName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityName: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  status: string;
  error: string | null;
  actorName: string;
  durationMs: number | null;
  createdAt: string;
}

interface AgentActivityTabProps {
  context?: string;
}

const ACTION_CONFIG: Record<string, { color: string; icon: typeof Plus }> = {
  create: { color: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20", icon: Plus },
  license: { color: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20", icon: UserCheck },
  update: { color: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/20", icon: RefreshCw },
  delete: { color: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20", icon: Trash2 },
  preview: { color: "bg-gray-500/15 text-muted-foreground border-gray-500/20", icon: Eye },
};

function getActionConfig(action: string) {
  const key = Object.keys(ACTION_CONFIG).find((k) => action.toLowerCase().includes(k));
  return ACTION_CONFIG[key ?? "preview"] ?? ACTION_CONFIG.preview;
}

function getStatusIcon(status: string) {
  switch (status) {
    case "confirmed":
    case "success":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 dark:text-green-400" />;
    case "preview":
    case "pending":
      return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
    case "failed":
    case "error":
      return <XCircle className="h-3.5 w-3.5 text-red-500 dark:text-red-400" />;
    default:
      return <Eye className="h-3.5 w-3.5 text-muted-foreground" />;
  }
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function ActivityEntry({ entry }: { entry: AgentLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const config = getActionConfig(entry.action);
  const ActionIcon = config.icon;

  return (
    <div className="group relative flex gap-3 py-3">
      {/* Timeline dot */}
      <div className="relative flex flex-col items-center">
        <div
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
            config.color
          )}
        >
          <ActionIcon className="h-3.5 w-3.5" />
        </div>
        {/* Timeline line — extends below dot */}
        <div className="absolute top-7 h-full w-px bg-border" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-1">
        {/* Header row */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", config.color)}>
            {entry.action}
          </Badge>
          <span className="truncate text-sm font-medium text-foreground">
            {entry.entityName ?? entry.entityType}
          </span>
          {getStatusIcon(entry.status)}
        </div>

        {/* Meta row */}
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>{formatRelativeTime(entry.createdAt)}</span>
          <span className="text-border">|</span>
          <span className="truncate">{entry.actorName}</span>
          {entry.durationMs != null && (
            <>
              <span className="text-border">|</span>
              <span>{entry.durationMs}ms</span>
            </>
          )}
          {entry.entityType && entry.entityType !== entry.entityName && (
            <>
              <span className="text-border">|</span>
              <span className="font-mono text-[10px]">{entry.entityType}</span>
            </>
          )}
        </div>

        {/* Error */}
        {entry.error && (
          <p className="mt-1.5 rounded bg-red-500/10 px-2 py-1 text-xs text-red-600 dark:text-red-400">
            {entry.error}
          </p>
        )}

        {/* Expandable details */}
        <button
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground transition hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
          Details
        </button>
        {expanded && (
          <div className="mt-2 space-y-2">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Input
              </p>
              <pre className="mt-1 max-h-40 overflow-auto rounded-md border bg-muted/50 p-2 text-[11px] font-mono text-foreground">
                {JSON.stringify(entry.input, null, 2)}
              </pre>
            </div>
            {entry.output && (
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Output
                </p>
                <pre className="mt-1 max-h-40 overflow-auto rounded-md border bg-muted/50 p-2 text-[11px] font-mono text-foreground">
                  {JSON.stringify(entry.output, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentActivityTab({ context }: AgentActivityTabProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["ai-activity", context],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "50" });
      if (context && context !== "global") params.set("context", context);
      const res = await fetch(`/api/ai/activity?${params}`);
      if (!res.ok) return { logs: [] };
      return res.json() as Promise<{ logs: AgentLogEntry[] }>;
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 className="h-5 w-5 animate-spin text-violet-500 dark:text-violet-400" />
        <p className="text-sm text-muted-foreground">Loading activity...</p>
      </div>
    );
  }

  if (isError || !data?.logs?.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/10">
          <BrainCircuit className="h-6 w-6 text-violet-500 dark:text-violet-400" />
        </div>
        <p className="text-sm font-medium text-foreground">No activity yet</p>
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          Agent actions will appear here as the AI assistant creates, updates, or previews resources on your behalf.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Agent Activity
          </h3>
          <span className="text-[11px] text-muted-foreground">
            {data.logs.length} action{data.logs.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="relative">
          {data.logs.map((entry, i) => (
            <div key={entry.id} className={cn(i === data.logs.length - 1 && "[&_.absolute.top-7]:hidden")}>
              <ActivityEntry entry={entry} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
