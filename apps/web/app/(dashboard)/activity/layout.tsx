"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/activity", label: "Routing History", exact: true },
  { href: "/activity/stats", label: "Assignment Stats", exact: false },
  { href: "/activity/failed", label: "Failed Routings", exact: false },
  { href: "/activity/audit", label: "Audit Log", exact: false },
  { href: "/activity/journey", label: "Record Journey", exact: false },
];

export default function HistoryLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-0">
      {/* Sub-navigation */}
      <div className="flex gap-1 border-b mb-6">
        {TABS.map((tab) => {
          const active = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
