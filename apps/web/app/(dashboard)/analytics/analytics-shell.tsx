"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/analytics", label: "Overview" },
  { href: "/analytics/rules", label: "Rules" },
  { href: "/analytics/teams", label: "Teams" },
  { href: "/analytics/conversions", label: "Conversions" },
];

const DATE_PRESETS = [
  { label: "Today", value: "today" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "90 days", value: "90d" },
];

export function AnalyticsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const dateRange = searchParams.get("range") || "30d";

  function setFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analytics</h1>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Date range presets */}
        <div className="flex rounded-md border bg-background">
          {DATE_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => setFilter("range", p.value)}
              className={cn(
                "px-3 py-1.5 text-sm border-r last:border-r-0 transition-colors",
                dateRange === p.value
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Export CSV */}
        <button
          onClick={() => {
            const view = pathname === "/analytics" ? "overview"
              : pathname.includes("/rules") ? "rules"
              : pathname.includes("/teams") ? "teams"
              : pathname.includes("/conversions") ? "conversions"
              : "overview";
            window.open(`/api/analytics/export?view=${view}&${searchParams.toString()}`);
          }}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </button>

        {/* Object type filter */}
        <select
          value={searchParams.get("objectType") || ""}
          onChange={e => setFilter("objectType", e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">All Objects</option>
          <option value="LEAD">Leads</option>
          <option value="CONTACT">Contacts</option>
          <option value="ACCOUNT">Accounts</option>
        </select>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b">
        {TABS.map(tab => {
          const active = pathname === tab.href;
          return (
            <button
              key={tab.href}
              onClick={() => router.push(tab.href + "?" + searchParams.toString())}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {children}
    </div>
  );
}
