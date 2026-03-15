"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, PartyPopper } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

// Map checklist item IDs to their target pages
const itemHrefs: Record<string, string> = {
  connect: "/integrations",
  deploy: "/integrations/salesforce",
  sync: "/integrations/salesforce",
  license: "/license-users",
  team: "/teams",
  rule: "/routing-rules",
};

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  href?: string;
}

interface OnboardingStatus {
  items: ChecklistItem[];
  completedCount: number;
  total: number;
  orgId: string;
}

function dismissedKey(orgId: string) {
  return `lr_onboarding_dismissed_${orgId}`;
}

async function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  const res = await fetch("/api/onboarding/status");
  if (!res.ok) throw new Error("Failed to fetch onboarding status");
  return res.json();
}

export function OnboardingChecklist() {
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: fetchOnboardingStatus,
    refetchInterval: 30_000,
  });

  const allDone = !!data && data.completedCount === data.total;

  // Read dismiss state from localStorage once we know the orgId (per-org key)
  useEffect(() => {
    if (data?.orgId && typeof window !== "undefined") {
      setDismissed(localStorage.getItem(dismissedKey(data.orgId)) === "1");
    }
  }, [data?.orgId]);

  // Auto-collapse when all steps complete
  useEffect(() => {
    if (allDone) {
      setExpanded(false);
    }
  }, [allDone]);

  if (!data || dismissed) return null;

  const pct = Math.round((data.completedCount / data.total) * 100);

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed(true);
    if (data?.orgId && typeof window !== "undefined") {
      localStorage.setItem(dismissedKey(data.orgId), "1");
    }
  };

  return (
    <div className="mx-2 mb-3 rounded-lg border-sidebar-border bg-sidebar-accent overflow-hidden">
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-sidebar-accent/80 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium leading-none">Getting started</p>
          {allDone ? (
            <p className="text-[11px] text-green-600 dark:text-green-400 mt-0.5 flex items-center gap-1">
              <PartyPopper className="h-3 w-3" />
              All done!
            </p>
          ) : (
            <p className="text-[11px] text-sidebar-muted-foreground mt-0.5">
              {data.completedCount}/{data.total} steps done
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {allDone && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleDismiss}
              onKeyDown={(e) => e.key === "Enter" && handleDismiss(e as unknown as React.MouseEvent)}
              className="rounded p-0.5 hover:bg-sidebar-accent text-sidebar-muted-foreground"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </span>
          )}
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-sidebar-muted-foreground" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-sidebar-muted-foreground" />
          )}
        </div>
      </button>

      {/* Progress bar */}
      <div className="h-1 bg-sidebar-border">
        <div
          className={cn(
            "h-full transition-all duration-500",
            allDone ? "bg-green-500 dark:bg-green-500" : "bg-primary"
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {expanded && (
        <ul className="px-3 py-2 space-y-1.5">
          {data.items.map((item) => {
            const href = item.href ?? itemHrefs[item.id];
            const content = (
              <>
                {item.done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 dark:text-green-400 shrink-0 mt-0.5" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-sidebar-muted-foreground shrink-0 mt-0.5" />
                )}
                <span
                  className={cn(
                    "text-[11px] leading-normal",
                    item.done ? "text-sidebar-muted-foreground line-through" : "text-sidebar-foreground"
                  )}
                >
                  {item.label}
                </span>
              </>
            );

            return (
              <li key={item.id}>
                {href ? (
                  <Link
                    href={href}
                    className="flex items-start gap-2 rounded px-1 -mx-1 py-0.5 hover:bg-sidebar-accent/80 transition-colors"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-start gap-2">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
