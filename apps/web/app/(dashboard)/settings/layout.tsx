"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/settings", label: "General" },
  { href: "/settings/notifications", label: "Webhooks" },
  { href: "/settings/ai", label: "AI Assistant" },
  { href: "/settings/ai/prompts", label: "AI Prompts" },
  { href: "/settings/ai/performance", label: "AI Performance" },
  { href: "/settings/license", label: "License" },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold font-display">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your organisation preferences</p>
      </div>

      <div className="flex gap-1 border-b">
        {TABS.map((tab) => {
          // For /settings/ai, only match exact path (not sub-pages like /ai/prompts)
          const isExactOnly =
            tab.href === "/settings" || tab.href === "/settings/ai";
          const active = isExactOnly
            ? pathname === tab.href
            : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
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

      <div>{children}</div>
    </div>
  );
}
