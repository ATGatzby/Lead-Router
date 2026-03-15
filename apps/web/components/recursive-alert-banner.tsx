"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "lr_recursive_alert_dismissed";
const POLL_INTERVAL = 60_000;

interface HealthData {
  recursiveBounces: { last1h: number };
  cooldownSkips: { last1h: number };
}

type Severity = "destructive" | "warning" | null;

function getSeverity(data: HealthData): Severity {
  if (data.recursiveBounces.last1h > 0) return "destructive";
  if (data.cooldownSkips.last1h > 5) return "warning";
  return null;
}

function getMessage(data: HealthData, severity: Severity): string {
  if (severity === "destructive") {
    return `Recursive routing detected \u2014 ${data.recursiveBounces.last1h} records were routed multiple times in the last hour`;
  }
  if (severity === "warning") {
    return `Cooldown safeguard active \u2014 ${data.cooldownSkips.last1h} duplicate events blocked in the last hour`;
  }
  return "";
}

export function RecursiveAlertBanner() {
  const [data, setData] = useState<HealthData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health/recursive");
      if (!res.ok) return;
      const json: HealthData = await res.json();
      setData(json);
    } catch {
      // Silently ignore fetch errors — banner simply won't show
    }
  }, []);

  useEffect(() => {
    const wasDismissed = sessionStorage.getItem(DISMISS_KEY);
    if (wasDismissed) setDismissed(true);

    fetchHealth();
    const id = setInterval(fetchHealth, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetchHealth]);

  if (dismissed || !data) return null;

  const severity = getSeverity(data);
  if (!severity) return null;

  const message = getMessage(data, severity);
  const Icon = severity === "destructive" ? ShieldAlert : AlertTriangle;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-3 px-4 py-3 text-sm border-b",
        severity === "destructive" &&
          "bg-destructive/10 text-destructive border-destructive/20",
        severity === "warning" &&
          "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-400"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <p className="flex-1">
        {message}{" "}
        <Link
          href="/trigger-health"
          className={cn(
            "underline underline-offset-2 font-medium",
            severity === "destructive"
              ? "text-destructive hover:text-destructive/80"
              : "text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
          )}
        >
          View details
        </Link>
      </p>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          sessionStorage.setItem(DISMISS_KEY, "1");
        }}
        className={cn(
          "shrink-0 rounded-sm p-0.5 opacity-70 hover:opacity-100 transition-opacity",
          severity === "destructive"
            ? "hover:bg-destructive/20"
            : "hover:bg-amber-500/20"
        )}
        aria-label="Dismiss alert"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
