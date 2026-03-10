"use client";

import { useMutation } from "@tanstack/react-query";
import { RefreshCw, Link2, AlertTriangle } from "lucide-react";
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
      {/* Salesforce Connection */}
      <section className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="font-semibold">Salesforce Connection</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your Salesforce OAuth connection and webhook settings.
          </p>
        </div>

        {/* Reconnect */}
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                Seeing &ldquo;Retry&rdquo; or &ldquo;Failed&rdquo; on all records?
              </p>
              <p className="text-sm text-amber-700 mt-0.5">
                Your Salesforce access token may have expired. Re-authenticate to get a fresh token.
                This won&apos;t affect your rules, teams, or users.
              </p>
            </div>
          </div>
          <a
            href="/api/auth/sfdc/login"
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
          >
            <Link2 className="h-3.5 w-3.5" />
            Reconnect Salesforce
          </a>
        </div>

        {/* Sync Webhook Secret */}
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
