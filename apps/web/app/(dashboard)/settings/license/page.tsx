"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Key, ShieldCheck, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface LicenseData {
  tier: string;
  limits: { rules: number; seats: number; objects: string[] };
  usage: { rules: number; seats: number };
  licenseKey: string | null;
  activatedAt: string | null;
  validUntil: string | null;
}

interface LicenseStatus {
  tier: string;
  lastHeartbeat: string | null;
  validUntil: string | null;
  graceActive: boolean;
  error: string | null;
}

function maskKey(key: string): string {
  if (key.length <= 8) return key;
  return key.slice(0, 4) + "\u2022\u2022\u2022\u2022" + key.slice(-4);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return formatDate(dateStr);
}

export default function LicenseSettingsPage() {
  const queryClient = useQueryClient();
  const [keyInput, setKeyInput] = useState("");

  const { data: license, isLoading: licenseLoading } = useQuery<LicenseData>({
    queryKey: ["license"],
    queryFn: async () => {
      const res = await fetch("/api/license");
      if (!res.ok) throw new Error("Failed to fetch license");
      return res.json();
    },
  });

  const { data: status } = useQuery<LicenseStatus>({
    queryKey: ["license-status"],
    queryFn: async () => {
      const res = await fetch("/api/license/status");
      if (!res.ok) throw new Error("Failed to fetch status");
      return res.json();
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch("/api/license/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Activation failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("License activated successfully");
      setKeyInput("");
      queryClient.invalidateQueries({ queryKey: ["license"] });
      queryClient.invalidateQueries({ queryKey: ["license-status"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/license/deactivate", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Deactivation failed");
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("License deactivated");
      queryClient.invalidateQueries({ queryKey: ["license"] });
      queryClient.invalidateQueries({ queryKey: ["license-status"] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const isPro = license?.tier === "pro" || !!license?.activatedAt;

  if (licenseLoading) {
    return (
      <div className="max-w-3xl">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-muted rounded" />
          <div className="h-48 bg-muted rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">License</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your subscription and license key
        </p>
      </div>

      {/* Plan card */}
      <div className="rounded-lg border bg-card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg",
                isPro ? "bg-emerald-500/10" : "bg-muted"
              )}
            >
              {isPro ? (
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
              ) : (
                <Key className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">
                  {isPro ? "Pro Plan" : "Free Plan"}
                </h3>
                {isPro && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600">
                    <Check className="h-3 w-3" />
                    Active
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                {isPro
                  ? "Unlimited rules, seats, and all object triggers"
                  : "Basic routing with limited capacity"}
              </p>
            </div>
          </div>
        </div>

        {/* Grace period warning */}
        {isPro && status?.graceActive && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/5">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
                License in grace period
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-400/80 mt-0.5">
                Your license could not be verified. Please check your connection
                or contact support.
              </p>
            </div>
          </div>
        )}

        {/* Pro details */}
        {isPro && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {license?.licenseKey && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  License Key
                </p>
                <p className="text-sm font-mono">
                  {maskKey(license.licenseKey)}
                </p>
              </div>
            )}
            {license?.activatedAt && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Activated
                </p>
                <p className="text-sm">{formatDate(license.activatedAt)}</p>
              </div>
            )}
            {license?.validUntil && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Valid Until
                </p>
                <p className="text-sm">{formatDate(license.validUntil)}</p>
              </div>
            )}
            {status?.lastHeartbeat && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Last Verified
                </p>
                <p className="text-sm">
                  {formatRelative(status.lastHeartbeat)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Free tier limits */}
        {!isPro && license && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Current Limits
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-md border bg-muted/50 px-4 py-3">
                <p className="text-2xl font-semibold">{license.limits.rules}</p>
                <p className="text-xs text-muted-foreground">Routing rules</p>
              </div>
              <div className="rounded-md border bg-muted/50 px-4 py-3">
                <p className="text-2xl font-semibold">{license.limits.seats}</p>
                <p className="text-xs text-muted-foreground">Team seats</p>
              </div>
              <div className="rounded-md border bg-muted/50 px-4 py-3">
                <p className="text-2xl font-semibold">Lead</p>
                <p className="text-xs text-muted-foreground">
                  Triggers only
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="border-t pt-5">
          {isPro ? (
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Are you sure you want to deactivate your license? You will lose access to Pro features."
                  )
                ) {
                  deactivateMutation.mutate();
                }
              }}
              disabled={deactivateMutation.isPending}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50 dark:border-red-500/20 dark:bg-red-500/5 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              {deactivateMutation.isPending
                ? "Deactivating..."
                : "Deactivate License"}
            </button>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="LR-XXXX-XXXX-XXXX-XXXX"
                  className="flex-1 rounded-lg border bg-transparent px-4 py-2 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={() => activateMutation.mutate(keyInput.trim())}
                  disabled={
                    !keyInput.trim() || activateMutation.isPending
                  }
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {activateMutation.isPending
                    ? "Activating..."
                    : "Activate License"}
                </button>
              </div>
              <p className="text-sm text-muted-foreground">
                Don&apos;t have a key?{" "}
                <a
                  href="https://openedgeai.tech/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Get one at openedgeai.tech/pricing
                </a>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
