"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { Users, GitFork, ArrowRightLeft, Zap, RefreshCw } from "lucide-react";
import { UpgradeModal } from "@/components/upgrade-modal";
import { useState } from "react";

interface BillingData {
  seats: { seatsPurchased: number; seatsUsed: number } | null;
  quota: {
    plan: "FREE" | "PAID";
    routingQuotaUsed: number;
    routingQuotaLimit: number;
    quotaResetAt: string;
    quotaPercent: number;
  } | null;
}

async function fetchBilling(): Promise<BillingData> {
  const res = await fetch("/api/settings/billing");
  if (!res.ok) throw new Error("Failed to fetch billing");
  return res.json();
}

export default function SettingsGeneralPage() {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeContext, setUpgradeContext] = useState<"seats" | "quota">("seats");
  const { data } = useQuery({ queryKey: ["settings-billing"], queryFn: fetchBilling });
  const [syncStatus, setSyncStatus] = useState<"idle" | "ok" | "error">("idle");

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/settings/sync-sfdc", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
    },
    onSuccess: () => { setSyncStatus("ok"); setTimeout(() => setSyncStatus("idle"), 3000); },
    onError: () => { setSyncStatus("error"); setTimeout(() => setSyncStatus("idle"), 3000); },
  });

  const seats = data?.seats;
  const quota = data?.quota;
  const seatsPercent = seats ? Math.round((seats.seatsUsed / seats.seatsPurchased) * 100) : 0;
  const quotaPercent = quota?.quotaPercent ?? 0;

  function openUpgrade(ctx: "seats" | "quota") {
    setUpgradeContext(ctx);
    setUpgradeOpen(true);
  }

  const quotaBarColor =
    quotaPercent >= 100 ? "bg-destructive" : quotaPercent >= 80 ? "bg-amber-500" : "bg-primary";

  return (
    <div className="max-w-2xl space-y-8">
      {/* Plan & Seats */}
      <section className="rounded-lg border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Plan & Seats</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {quota?.plan && (
                <span className="inline-flex items-center mr-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                  {quota.plan}
                </span>
              )}
              Manage your subscription and seat allocation
            </p>
          </div>
          <button
            onClick={() => openUpgrade("seats")}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Zap className="h-3.5 w-3.5" />
            Upgrade
          </button>
        </div>

        {seats && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Licensed seats used</span>
              <span className="font-medium">
                {seats.seatsUsed} / {seats.seatsPurchased}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(seatsPercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{seatsPercent}% of seats used</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 pt-2">
          {[
            { icon: Users, label: "License Users", desc: "Assign seats to reps" },
            { icon: GitFork, label: "Round Robins", desc: "Manage rotation teams" },
            { icon: ArrowRightLeft, label: "Routing Rules", desc: "Configure assignment logic" },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="rounded-md border p-3 text-center space-y-1">
              <Icon className="h-5 w-5 mx-auto text-muted-foreground" />
              <p className="text-xs font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Routing Quota */}
      {quota && (
        <section className="rounded-lg border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Routing Quota</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Monthly leads routed through the engine
              </p>
            </div>
            {quota.plan === "FREE" && quotaPercent >= 80 && (
              <button
                onClick={() => openUpgrade("quota")}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Zap className="h-3.5 w-3.5" />
                Upgrade
              </button>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Leads routed this month</span>
              <span className="font-medium">
                {quota.routingQuotaUsed.toLocaleString()} / {quota.routingQuotaLimit.toLocaleString()}
              </span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${quotaBarColor}`}
                style={{ width: `${Math.min(quotaPercent, 100)}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{quotaPercent}% of monthly limit used</p>
              <p className="text-xs text-muted-foreground">
                Resets{" "}
                {new Date(quota.quotaResetAt).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>

          {quotaPercent >= 100 && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              Routing is paused. Upgrade to resume routing leads immediately.
            </div>
          )}
        </section>
      )}

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

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        context={upgradeContext}
      />
    </div>
  );
}
