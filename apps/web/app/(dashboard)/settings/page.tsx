"use client";

import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

export default function SettingsGeneralPage() {
  const [syncStatus, setSyncStatus] = useState<"idle" | "ok" | "error">("idle");

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/sync-sfdc", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
    },
    onSuccess: () => { setSyncStatus("ok"); setTimeout(() => setSyncStatus("idle"), 3000); },
    onError: () => { setSyncStatus("error"); setTimeout(() => setSyncStatus("idle"), 3000); },
  });

  return (
    <div className="max-w-2xl space-y-8">
      {/* Salesforce Sync */}
      <section className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Salesforce Connection</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Keep your webhook secret in sync between Lead Routing and Salesforce.
            This runs automatically when you connect your org — use this button if you ever
            see signature errors.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            {syncMutation.isPending ? "Syncing…" : "Sync Webhook Secret"}
          </button>
          {syncStatus === "ok" && (
            <span className="text-sm text-green-600">Synced to Salesforce</span>
          )}
          {syncStatus === "error" && (
            <span className="text-sm text-destructive">Sync failed — check Salesforce connection</span>
          )}
        </div>
      </section>
    </div>
  );
}
