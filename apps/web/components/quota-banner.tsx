"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { UpgradeModal } from "./upgrade-modal";

interface BillingData {
  quota: {
    plan: "FREE" | "PAID";
    routingQuotaUsed: number;
    routingQuotaLimit: number;
    quotaResetAt: string;
    quotaPercent: number;
  };
}

async function fetchBilling(): Promise<BillingData> {
  const res = await fetch("/api/settings/billing");
  if (!res.ok) throw new Error("Failed to fetch billing");
  return res.json();
}

export function QuotaBanner() {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["billing"], queryFn: fetchBilling });

  const quota = data?.quota;
  if (!quota || quota.quotaPercent < 80) return null;

  const isExceeded = quota.quotaPercent >= 100;
  const resetDate = new Date(quota.quotaResetAt).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });

  return (
    <>
      <div
        className={`flex items-center justify-between gap-4 px-6 py-2.5 text-sm border-b ${
          isExceeded
            ? "bg-destructive/10 border-destructive/20 text-destructive"
            : "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800/40 dark:text-amber-400"
        }`}
      >
        <span>
          {isExceeded ? (
            <>
              Monthly routing limit reached ({quota.routingQuotaLimit} leads). Routing is paused until{" "}
              <strong>{resetDate}</strong>.
            </>
          ) : (
            <>
              You&apos;ve used <strong>{quota.quotaPercent}%</strong> of your monthly routing quota
              ({quota.routingQuotaUsed} / {quota.routingQuotaLimit} leads). Resets{" "}
              <strong>{resetDate}</strong>.
            </>
          )}
        </span>
        {quota.plan === "FREE" && (
          <button
            onClick={() => setUpgradeOpen(true)}
            className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              isExceeded
                ? "bg-destructive text-white hover:bg-destructive/90"
                : "bg-amber-600 text-white hover:bg-amber-700"
            }`}
          >
            Upgrade
          </button>
        )}
      </div>
      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        context="quota"
      />
    </>
  );
}
