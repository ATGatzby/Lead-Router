"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface RoutingLog {
  id: string;
  sfdcRecordId: string;
  objectType: "LEAD" | "CONTACT" | "ACCOUNT";
  retryCount: number;
  errorMessage: string | null;
  createdAt: string;
  status: "FAILED" | "RETRY";
}

// ─── Main ────────────────────────────────────────────────────────────────────

export default function FailedRoutingsPage() {
  const qc = useQueryClient();
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const query = useQuery<{ logs: RoutingLog[] }>({
    queryKey: ["routing-logs-failed"],
    queryFn: async () => {
      const res = await fetch("/api/routing-logs/failed");
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/routing-logs/${id}/retry`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Retry failed");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routing-logs-failed"] });
      showToast("Re-enqueued for retry");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const retryAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/routing-logs/retry-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Retry all failed");
      return data as { retried: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["routing-logs-failed"] });
      showToast(`Re-enqueued ${data.retried} records for retry`);
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/routing-logs/${id}/dismiss`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Dismiss failed");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["routing-logs-failed"] });
      showToast("Dismissed");
    },
    onError: (err: Error) => showToast(err.message, "error"),
  });

  const logs = query.data?.logs ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Failed Routings</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Records that could not be routed after all retry attempts.
          </p>
        </div>
        {logs.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={retryAllMutation.isPending}
            onClick={() => retryAllMutation.mutate()}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", retryAllMutation.isPending && "animate-spin")} />
            {retryAllMutation.isPending ? "Retrying…" : `Retry All (${logs.length})`}
          </Button>
        )}
      </div>

      {/* Banner */}
      {query.isSuccess && logs.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
          <span className="text-sm text-yellow-800 dark:text-yellow-300 font-medium">
            {logs.length} routing {logs.length === 1 ? "failure needs" : "failures need"} attention
          </span>
        </div>
      )}

      {/* Loading / Error */}
      {query.isLoading && (
        <div className="text-center py-16 text-muted-foreground text-sm">Loading…</div>
      )}
      {query.isError && (
        <div className="text-center py-16 text-destructive text-sm">Failed to load.</div>
      )}

      {/* Empty */}
      {query.isSuccess && logs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-950/40 flex items-center justify-center">
            <span className="text-green-600 text-lg">✓</span>
          </div>
          <p className="text-muted-foreground text-sm">No failed routings — everything looks good.</p>
        </div>
      )}

      {/* Table */}
      {logs.length > 0 && (
        <div className="rounded-xl border overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[1.4fr_80px_80px_80px_2fr_160px] items-center gap-3 px-4 py-2.5 bg-muted/40 border-b text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>Record ID</span>
            <span>Object</span>
            <span>Status</span>
            <span>Attempts</span>
            <span>Error</span>
            <span className="text-right">Actions</span>
          </div>

          {logs.map((log) => (
            <div
              key={log.id}
              className="grid grid-cols-[1.4fr_80px_80px_80px_2fr_160px] items-center gap-3 px-4 py-3 border-b last:border-b-0 bg-card"
            >
              <span className="font-mono text-xs">{log.sfdcRecordId}</span>
              <span className="text-sm text-muted-foreground capitalize">
                {log.objectType.charAt(0) + log.objectType.slice(1).toLowerCase()}
              </span>
              <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full w-fit", log.status === "FAILED" ? "bg-red-100 text-red-700" : "bg-yellow-100 text-yellow-700")}>
                {log.status === "FAILED" ? "Failed" : "Retry"}
              </span>
              <span className="text-sm text-muted-foreground">{log.retryCount} {log.retryCount === 1 ? "retry" : "retries"}</span>
              <span className="text-sm text-destructive truncate">{log.errorMessage ?? "Unknown error"}</span>
              <div className="flex items-center gap-2 justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={retryMutation.isPending}
                  onClick={() => retryMutation.mutate(log.id)}
                >
                  <RefreshCw className={cn("h-3 w-3 mr-1", retryMutation.isPending && "animate-spin")} />
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground"
                  disabled={dismissMutation.isPending}
                  onClick={() => dismissMutation.mutate(log.id)}
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg",
            toast.type === "error" ? "bg-destructive text-white" : "bg-foreground text-background"
          )}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
