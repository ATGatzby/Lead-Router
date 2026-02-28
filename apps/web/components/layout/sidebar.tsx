"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Users,
  GitFork,
  ArrowRightLeft,
  History,
  Settings,
  Zap,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { OnboardingChecklist } from "@/components/onboarding-checklist";

const NAV_SECTIONS = [
  {
    label: "Setup",
    items: [
      { href: "/license-users", label: "License Users", icon: Users },
      { href: "/round-robins", label: "Round Robins", icon: GitFork },
    ],
  },
  {
    label: "Routing",
    items: [
      {
        href: "/routing-rules",
        label: "Routing Rules",
        icon: ArrowRightLeft,
      },
      { href: "/history", label: "History", icon: History },
    ],
  },
  {
    label: "Reports",
    items: [
      {
        href: "/analytics",
        label: "Analytics",
        icon: BarChart3,
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        href: "/settings",
        label: "Settings",
        icon: Settings,
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-56 flex-col border-r bg-card">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 px-4 border-b">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">
          LR
        </div>
        <span className="text-sm font-semibold">Lead Router</span>
        <div className="ml-auto">
          <Zap className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </div>

      {/* Onboarding checklist */}
      <OnboardingChecklist />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
        {NAV_SECTIONS.map((section, idx) => (
          <div key={section.label}>
            {idx !== 0 && <Separator className="mb-3" />}
            <p className="px-2 mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
